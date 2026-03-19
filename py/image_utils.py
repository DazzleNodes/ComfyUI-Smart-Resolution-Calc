"""
Image creation and transformation utilities for DazzleNodes.

Contains:
- create_empty_image: Generate images with fill patterns (black, white, color, noise, DazNoise)
- transform_image: Scale to exact dimensions (distort)
- transform_image_scale_pad: Scale + pad with AR preservation
- transform_image_crop_pad: Crop/pad without scaling
- transform_image_scale_crop: Scale + crop with AR preservation

These are methods extracted from SmartResolutionCalc but can be
reused by other DazzleNodes nodes for image manipulation.
"""

import numpy as np
import torch
import logging
import os
from PIL import Image, ImageDraw, ImageFont

from .noise_utils import _generate_daznoise, pil2tensor

try:
    import comfy.utils
except ImportError:
    comfy = None  # Allow import without ComfyUI for testing

logger = logging.getLogger('SmartResolutionCalc')


def create_empty_image(
    width: int,
    height: int,
    fill_type: str = "black",
    fill_color: str = "#808080",
    batch_size: int = 1,
    fill_image: torch.Tensor = None
    ) -> torch.Tensor:
    """
    Create empty image with specified fill pattern.

    Args:
        width: Image width in pixels
        height: Image height in pixels
        fill_type: Fill pattern - "black", "white", "custom_color", "noise", "random",
                   or DazNoise types when dazzle-comfy-plasma-fast is available
        fill_color: Hex color string for "custom_color" mode (e.g., "#FF0000")
        batch_size: Number of images in batch
        fill_image: Optional custom fill image tensor. When provided, overrides fill_type.

    Returns:
        Tensor of shape [batch_size, height, width, 3] with values 0.0-1.0
    """
    # Priority: fill_image overrides fill_type when connected
    if fill_image is not None:
        # Scale the fill_image to target dimensions
        image = transform_image(fill_image, width, height)
        # Handle batch size mismatch
        if image.shape[0] < batch_size:
            image = image.repeat(batch_size, 1, 1, 1)[:batch_size]
        logger.debug(f"Using fill_image ({fill_image.shape[2]}x{fill_image.shape[1]}) scaled to {width}x{height}")
        return image

    # Create base tensor
    if fill_type == "black":
        # All zeros (black)
        image = torch.zeros((batch_size, height, width, 3))

    elif fill_type == "white":
        # All ones (white)
        image = torch.ones((batch_size, height, width, 3))

    elif fill_type == "custom_color":
        # Parse hex color to RGB (0.0-1.0 range)
        try:
            color_hex = fill_color.strip()
            if not color_hex.startswith('#'):
                color_hex = '#' + color_hex

            r = int(color_hex[1:3], 16) / 255.0
            g = int(color_hex[3:5], 16) / 255.0
            b = int(color_hex[5:7], 16) / 255.0
        except (ValueError, IndexError):
            # Fallback to gray on invalid color
            logger.warning(f"Invalid hex color '{fill_color}', using gray")
            r, g, b = 0.5, 0.5, 0.5

        # Fill with custom color
        image = torch.zeros((batch_size, height, width, 3))
        image[:, :, :, 0] = r
        image[:, :, :, 1] = g
        image[:, :, :, 2] = b

    elif fill_type == "noise":
        # Gaussian noise (mean=0.5, std=0.1)
        image = torch.randn((batch_size, height, width, 3)) * 0.1 + 0.5
        image = torch.clamp(image, 0.0, 1.0)

    elif fill_type == "random":
        # Uniform random values [0.0, 1.0]
        image = torch.rand((batch_size, height, width, 3))

    elif fill_type.startswith("DazNoise:"):
        # Extended noise from dazzle-comfy-plasma-fast
        noise_tensor = _generate_daznoise(fill_type, width, height)
        if noise_tensor is not None:
            # Generator returns (1, H, W, 3) — repeat for batch
            if batch_size > 1:
                image = noise_tensor.repeat(batch_size, 1, 1, 1)
            else:
                image = noise_tensor
        else:
            # Fallback: dazzle-comfy-plasma-fast unavailable at execution time
            logger.warning(f"'{fill_type}' requires dazzle-comfy-plasma-fast (not found), using Gaussian noise")
            print(f"[SmartResCalc] WARNING: {fill_type} unavailable, falling back to Gaussian noise")
            image = torch.randn((batch_size, height, width, 3)) * 0.1 + 0.5
            image = torch.clamp(image, 0.0, 1.0)

    else:
        # Fallback to black for unknown types
        logger.warning(f"Unknown fill_type '{fill_type}', using black")
        image = torch.zeros((batch_size, height, width, 3))

    return image

def transform_image(image: torch.Tensor, target_width: int, target_height: int) -> torch.Tensor:
    """
    Transform input image to target dimensions using bilinear interpolation (distort mode).
    Scales image to exactly fit target dimensions without preserving aspect ratio.

    Args:
        image: Input tensor [batch, height, width, channels]
        target_width: Target width in pixels
        target_height: Target height in pixels

    Returns:
        Transformed tensor [batch, target_height, target_width, channels]
    """
    # Convert NHWC -> NCHW for interpolate
    samples = image.movedim(-1, 1)

    # Use ComfyUI's standard upscale function
    # Method: "bilinear" (fast, good quality, general purpose)
    # Crop: "disabled" (scale to fit, no cropping)
    output = comfy.utils.common_upscale(
        samples,
        target_width,
        target_height,
        "bilinear",
        "disabled"
    )

    # Convert back NCHW -> NHWC
    output = output.movedim(1, -1)

    return output

def transform_image_scale_pad(
    image: torch.Tensor,
    target_width: int,
    target_height: int,
    fill_type: str = "black",
    fill_color: str = "#808080",
    fill_image: torch.Tensor = None
    ) -> torch.Tensor:
    """
    Transform input image to target dimensions using scale/pad strategy.
    Scales image to fit within target, then pads to reach exact dimensions.

    Strategy:
    - Scale image to fit INSIDE target dimensions (maintaining aspect ratio)
    - Center the scaled image within target canvas
    - Pad remaining space with specified fill pattern
    - Result always matches target dimensions exactly

    Args:
        image: Input tensor [batch, height, width, channels]
        target_width: Target width in pixels
        target_height: Target height in pixels
        fill_type: Fill pattern for padding areas
        fill_color: Hex color for custom_color fill
        fill_image: Optional custom fill image tensor

    Returns:
        Transformed tensor [batch, target_height, target_width, channels]
    """
    batch_size, source_height, source_width, channels = image.shape

    # Calculate aspect ratios
    source_ar = source_width / source_height
    target_ar = target_width / target_height

    logger.debug(f"Crop/pad transform: source={source_width}×{source_height} (AR={source_ar:.3f}), "
                f"target={target_width}×{target_height} (AR={target_ar:.3f})")

    # Determine if we need to crop or pad
    if abs(source_ar - target_ar) < 0.001:
        # Aspect ratios match - simple scale to fit
        logger.debug("Aspect ratios match, scaling to fit")
        return transform_image(image, target_width, target_height)

    # Calculate scaled dimensions to fit inside target while maintaining AR
    if source_ar > target_ar:
        # Source is wider - fit to target width, height will be smaller
        scale_width = target_width
        scale_height = int(target_width / source_ar)
    else:
        # Source is taller - fit to target height, width will be smaller
        scale_height = target_height
        scale_width = int(target_height * source_ar)

    logger.debug(f"Scaling to {scale_width}×{scale_height} (fits within {target_width}×{target_height})")

    # Scale image to fit within target
    scaled = transform_image(image, scale_width, scale_height)

    # Create canvas with target dimensions filled with specified pattern
    # Use batch size from input image, not the parameter
    canvas = create_empty_image(target_width, target_height, fill_type, fill_color, batch_size, fill_image)

    # Calculate centering offsets
    offset_x = (target_width - scale_width) // 2
    offset_y = (target_height - scale_height) // 2

    logger.debug(f"Centering scaled image at offset ({offset_x}, {offset_y})")

    # Place scaled image in center of canvas
    canvas[:, offset_y:offset_y+scale_height, offset_x:offset_x+scale_width, :] = scaled

    # Verify output dimensions
    assert canvas.shape[1] == target_height and canvas.shape[2] == target_width, \
        f"Output dimensions mismatch: got {canvas.shape[2]}×{canvas.shape[1]}, expected {target_width}×{target_height}"

    return canvas

def transform_image_crop_pad(
    image: torch.Tensor,
    target_width: int,
    target_height: int,
    fill_type: str = "black",
    fill_color: str = "#808080",
    fill_image: torch.Tensor = None
    ) -> torch.Tensor:
    """
    Transform input image to target dimensions using pure crop/pad (NO scaling).
    Crops dimensions larger than target, pads dimensions smaller than target.

    Strategy:
    - NO scaling applied - original image stays at 1:1 scale
    - If dimension > target: Center crop to target size
    - If dimension < target: Center and pad to target size
    - Result always matches target dimensions exactly

    Example: 1024×1024 → 1885×530
    - Width: 1024 < 1885, pad 430.5px left + 430.5px right
    - Height: 1024 > 530, crop 247px top + 247px bottom

    Args:
        image: Input tensor [batch, height, width, channels]
        target_width: Target width in pixels
        target_height: Target height in pixels
        fill_type: Fill pattern for padding areas
        fill_color: Hex color for custom_color fill
        fill_image: Optional custom fill image tensor

    Returns:
        Transformed tensor [batch, target_height, target_width, channels]
    """
    batch_size, source_height, source_width, channels = image.shape

    logger.debug(f"Crop/pad transform (no scaling): source={source_width}×{source_height}, "
                f"target={target_width}×{target_height}")

    # Determine crop/pad for width
    if source_width == target_width:
        # Width matches - use original
        width_start = 0
        width_end = source_width
        pad_left = 0
        pad_right = 0
        logger.debug(f"Width matches target ({target_width})")
    elif source_width > target_width:
        # Width larger - center crop
        width_start = (source_width - target_width) // 2
        width_end = width_start + target_width
        pad_left = 0
        pad_right = 0
        logger.debug(f"Cropping width: {source_width} → {target_width} (crop from {width_start})")
    else:
        # Width smaller - will need padding
        width_start = 0
        width_end = source_width
        pad_left = (target_width - source_width) // 2
        pad_right = target_width - source_width - pad_left
        logger.debug(f"Padding width: {source_width} → {target_width} (pad left={pad_left}, right={pad_right})")

    # Determine crop/pad for height
    if source_height == target_height:
        # Height matches - use original
        height_start = 0
        height_end = source_height
        pad_top = 0
        pad_bottom = 0
        logger.debug(f"Height matches target ({target_height})")
    elif source_height > target_height:
        # Height larger - center crop
        height_start = (source_height - target_height) // 2
        height_end = height_start + target_height
        pad_top = 0
        pad_bottom = 0
        logger.debug(f"Cropping height: {source_height} → {target_height} (crop from {height_start})")
    else:
        # Height smaller - will need padding
        height_start = 0
        height_end = source_height
        pad_top = (target_height - source_height) // 2
        pad_bottom = target_height - source_height - pad_top
        logger.debug(f"Padding height: {source_height} → {target_height} (pad top={pad_top}, bottom={pad_bottom})")

    # Crop the image (if needed)
    cropped = image[:, height_start:height_end, width_start:width_end, :]

    # If no padding needed, we're done
    if pad_left == 0 and pad_right == 0 and pad_top == 0 and pad_bottom == 0:
        logger.debug("No padding needed, returning cropped image")
        return cropped

    # Create canvas with target dimensions
    canvas = create_empty_image(target_width, target_height, fill_type, fill_color, batch_size, fill_image)

    # Place cropped image in canvas at correct position
    canvas[:, pad_top:pad_top+cropped.shape[1], pad_left:pad_left+cropped.shape[2], :] = cropped

    # Verify output dimensions
    assert canvas.shape[1] == target_height and canvas.shape[2] == target_width, \
        f"Output dimensions mismatch: got {canvas.shape[2]}×{canvas.shape[1]}, expected {target_width}×{target_height}"

    return canvas

def transform_image_scale_crop(
    image: torch.Tensor,
    target_width: int,
    target_height: int
    ) -> torch.Tensor:
    """
    Transform input image to target dimensions using scale/crop strategy.
    Scales image to cover target completely, then crops excess.

    Strategy:
    - Scale image to COVER target dimensions (maintaining aspect ratio)
    - At least one dimension will match target exactly
    - Other dimension will be >= target
    - Center crop the excess
    - Result always matches target dimensions exactly

    Example: 1024×1024 → 1885×530
    - Scale to 1885×1885 (covers target width, maintains square AR)
    - Crop 677.5px from top + 677.5px from bottom

    Args:
        image: Input tensor [batch, height, width, channels]
        target_width: Target width in pixels
        target_height: Target height in pixels

    Returns:
        Transformed tensor [batch, target_height, target_width, channels]
    """
    batch_size, source_height, source_width, channels = image.shape

    # Calculate aspect ratios
    source_ar = source_width / source_height
    target_ar = target_width / target_height

    logger.debug(f"Scale/crop transform: source={source_width}×{source_height} (AR={source_ar:.3f}), "
                f"target={target_width}×{target_height} (AR={target_ar:.3f})")

    # Check if aspect ratios match
    if abs(source_ar - target_ar) < 0.001:
        # Aspect ratios match - simple scale to fit
        logger.debug("Aspect ratios match, scaling to fit")
        return transform_image(image, target_width, target_height)

    # Calculate scaled dimensions to cover target while maintaining AR
    if source_ar > target_ar:
        # Source is wider - fit to target height, width will be larger
        scale_height = target_height
        scale_width = int(target_height * source_ar)
    else:
        # Source is taller - fit to target width, height will be larger
        scale_width = target_width
        scale_height = int(target_width / source_ar)

    logger.debug(f"Scaling to {scale_width}×{scale_height} (covers {target_width}×{target_height})")

    # Scale image to cover target
    scaled = transform_image(image, scale_width, scale_height)

    # Center crop to target dimensions
    if scale_width > target_width:
        # Crop width
        crop_left = (scale_width - target_width) // 2
        crop_right = crop_left + target_width
        output = scaled[:, :, crop_left:crop_right, :]
        logger.debug(f"Cropped width from {scale_width} to {target_width} (left={crop_left})")
    else:
        # Crop height
        crop_top = (scale_height - target_height) // 2
        crop_bottom = crop_top + target_height
        output = scaled[:, crop_top:crop_bottom, :, :]
        logger.debug(f"Cropped height from {scale_height} to {target_height} (top={crop_top})")

    # Verify output dimensions
    assert output.shape[1] == target_height and output.shape[2] == target_width, \
        f"Output dimensions mismatch: got {output.shape[2]}×{output.shape[1]}, expected {target_width}×{target_height}"

    return output



def create_preview_image(width, height, resolution, ratio_display, megapixels):
    """
    Create preview image showing aspect ratio box with dimensions.
    Based on controlaltai-nodes implementation.
    """
    # 1024x1024 preview size
    preview_size = (1024, 1024)
    image = Image.new('RGB', preview_size, (0, 0, 0))  # Black background
    draw = ImageDraw.Draw(image)

    # Draw grid with grey lines
    grid_color = '#333333'
    grid_spacing = 50
    for x in range(0, preview_size[0], grid_spacing):
        draw.line([(x, 0), (x, preview_size[1])], fill=grid_color)
    for y in range(0, preview_size[1], grid_spacing):
        draw.line([(0, y), (preview_size[0], y)], fill=grid_color)

    # Calculate preview box dimensions (maintain aspect ratio)
    preview_width = 800
    preview_height = int(preview_width * (height / width))

    # Adjust if height is too tall
    if preview_height > 800:
        preview_height = 800
        preview_width = int(preview_height * (width / height))

    # Calculate center position
    x_offset = (preview_size[0] - preview_width) // 2
    y_offset = (preview_size[1] - preview_height) // 2

    # Draw the aspect ratio box with red outline
    draw.rectangle(
        [(x_offset, y_offset), (x_offset + preview_width, y_offset + preview_height)],
        outline='red',
        width=4
    )

    # Add text with dimension info
    try:
        # Resolution text in center (red)
        text_y = y_offset + preview_height // 2
        draw.text(
            (preview_size[0] // 2, text_y),
            f"{width}x{height}",
            fill='red',
            anchor="mm",
            font=ImageFont.truetype("arial.ttf", 48)
        )

        # Aspect ratio text below resolution (red)
        draw.text(
            (preview_size[0] // 2, text_y + 60),
            f"({ratio_display})",
            fill='red',
            anchor="mm",
            font=ImageFont.truetype("arial.ttf", 36)
        )

        # Megapixels text at bottom (white)
        draw.text(
            (preview_size[0] // 2, y_offset + preview_height + 60),
            f"{megapixels:.2f} MP",
            fill='white',
            anchor="mm",
            font=ImageFont.truetype("arial.ttf", 32)
        )

    except:
        # Fallback if font loading fails (non-Windows systems)
        draw.text((preview_size[0] // 2, text_y), f"{width}x{height}", fill='red', anchor="mm")
        draw.text((preview_size[0] // 2, text_y + 60), f"({ratio_display})", fill='red', anchor="mm")
        draw.text((preview_size[0] // 2, y_offset + preview_height + 60), f"{megapixels:.2f} MP", fill='white', anchor="mm")

    # Convert to tensor
    return pil2tensor(image)

def create_latent(width, height, batch_size=1, vae=None, device=None):
    """
    Create empty latent tensor compatible with the connected model.

    Queries the VAE for both latent_channels and spatial compression ratio
    to support all model types (SD1.5=4ch/8x, FLUX=16ch/8x, patchified
    VAEs=16ch/16x, Cascade=16ch/32x, etc.). Falls back to 4 channels and
    8x spatial when no VAE is connected (matches ComfyUI EmptyLatentImage).

    Format depends on VAE type:
    - 2D VAEs (SD1.5, FLUX, etc.): [batch, channels, h//spatial, w//spatial]
    - 3D/Video VAEs (Wan, Qwen, etc.): [batch, channels, 1, h//spatial, w//spatial]

    Args:
        width: Image width in pixels
        height: Image height in pixels
        batch_size: Number of latents in batch
        vae: Optional ComfyUI VAE object for channel/spatial info
        device: Torch device for tensor creation
    """
    channels = 4
    spatial_divisor = 8
    if vae is not None:
        if hasattr(vae, 'latent_channels'):
            channels = vae.latent_channels
        if hasattr(vae, 'spacial_compression_encode'):
            spatial_divisor = vae.spacial_compression_encode()

    latent_h = height // spatial_divisor
    latent_w = width // spatial_divisor

    # Video/3D VAEs (Wan, Qwen, Hunyuan Video) have latent_dim=3 and expect
    # 5D tensors with a temporal dimension. For single-image generation we use
    # temporal=1. Without this, VAE.decode() crashes because its memory_used_decode
    # lambda accesses shape[4] which doesn't exist on a 4D tensor.
    if vae is not None and getattr(vae, 'latent_dim', 2) == 3:
        latent = torch.zeros([batch_size, channels, 1, latent_h, latent_w], device=device)
        logger.debug(f"Created 5D latent for video VAE: {latent.shape} (latent_dim=3)")
    else:
        latent = torch.zeros([batch_size, channels, latent_h, latent_w], device=device)
        logger.debug(f"Created 4D latent: {latent.shape}")

    return {"samples": latent, "downscale_ratio_spacial": spatial_divisor}




def get_image_dimensions_from_path(image_path):
    """
    Extract image dimensions from a file path using PIL.

    Security: Validates path is within ComfyUI directories before reading.
    Handles both full paths and filenames (searches in input directory).

    Args:
        image_path: Absolute path, relative path, or filename

    Returns:
        dict: {'width': int, 'height': int, 'success': bool, 'error': str}
    """
    try:
        import folder_paths

        # Check for directory traversal attempts early
        if '..' in image_path:
            logger.warning(f"Rejected path with traversal attempt: {image_path}")
            return {
                'success': False,
                'error': 'Invalid path'
            }

        # If image_path is just a filename (no path separators), look in input directory
        if not os.path.dirname(image_path):
            # Just a filename - construct path in input directory
            input_dir = folder_paths.get_input_directory()
            abs_path = os.path.join(input_dir, image_path)
            logger.debug(f"Filename detected, using input directory: {abs_path}")
        else:
            # Has directory components - normalize as absolute path
            abs_path = os.path.abspath(image_path)

        # Security: Only allow paths within ComfyUI directories
        allowed_dirs = [
            os.path.abspath(folder_paths.get_input_directory()),
            os.path.abspath(folder_paths.get_output_directory()),
            os.path.abspath(folder_paths.get_temp_directory()),
        ]

        # Check if path is within allowed directories
        is_allowed = any(abs_path.startswith(allowed_dir) for allowed_dir in allowed_dirs)

        if not is_allowed:
            logger.warning(f"Rejected path outside allowed directories: {abs_path}")
            return {
                'success': False,
                'error': 'Path outside allowed directories'
            }

        # Check file exists
        if not os.path.exists(abs_path):
            logger.debug(f"File not found: {abs_path}")
            return {
                'success': False,
                'error': f'File not found: {os.path.basename(abs_path)}'
            }

        # Read image dimensions using PIL
        with Image.open(abs_path) as img:
            width, height = img.size
            logger.debug(f"Successfully read dimensions: {width}×{height} from {abs_path}")
            return {
                'width': width,
                'height': height,
                'success': True
            }

    except Exception as e:
        logger.error(f"Error reading image dimensions: {e}")
        return {
            'success': False,
            'error': str(e)
        }

