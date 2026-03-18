/**
 * ColorPickerButton -- compact button that opens a color picker popup
 *
 * Extracted from smart_resolution_calc.js (Phase 9 refactor).
 *
 * Dependencies:
 * - visibilityLogger from debug_logger.js
 */

import { visibilityLogger } from '../utils/debug_logger.js';


/**
 * Color Picker Button Widget
 * Custom widget that displays a color palette in canvas space for reliable positioning
 */
class ColorPickerButton {
    constructor(name = "color_picker_button", fillColorWidget) {
        this.name = name;
        this.type = "custom";  // Must be "custom" for addCustomWidget to route mouse events
        this.value = null;  // Buttons don't need a value
        this.fillColorWidget = fillColorWidget;  // Reference to fill_color widget for value storage

        // State
        this.isHoveringButton = false;
    }

    draw(ctx, node, width, y, height) {
        ctx.save();

        const x = 15;  // Standard widget left margin
        const buttonHeight = 28;
        const buttonWidth = width - 30;

        // Get current color
        const currentColor = this.fillColorWidget.value || "#808080";
        const normalizedColor = currentColor.startsWith('#') ? currentColor : '#' + currentColor;

        // Helper to get contrasting text color
        const getContrastColor = (hexColor) => {
            const hex = hexColor.replace('#', '');
            const r = parseInt(hex.substr(0, 2), 16);
            const g = parseInt(hex.substr(2, 2), 16);
            const b = parseInt(hex.substr(4, 2), 16);
            const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
            return luminance > 0.5 ? '#000000' : '#FFFFFF';
        };

        const contrastColor = getContrastColor(normalizedColor);

        // === Draw Button ===

        // Button background (current color)
        ctx.fillStyle = normalizedColor;
        ctx.fillRect(x, y, buttonWidth, buttonHeight);

        // Button border
        ctx.strokeStyle = this.isHoveringButton ? "#888" : "#666";
        ctx.lineWidth = this.isHoveringButton ? 2 : 1;
        ctx.strokeRect(x, y, buttonWidth, buttonHeight);

        // Button text
        ctx.fillStyle = contrastColor;
        ctx.font = "12px monospace";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(`🎨 ${normalizedColor.toUpperCase()}`, x + buttonWidth / 2, y + buttonHeight / 2);

        // Store button hit area
        this.hitAreaButton = { x, y, width: buttonWidth, height: buttonHeight };

        ctx.restore();
    }

    mouse(event, pos, node) {
        if (event.type === "pointermove") {
            // Check button hover
            const wasHoveringButton = this.isHoveringButton;
            this.isHoveringButton = this.isInBounds(pos, this.hitAreaButton);
            if (this.isHoveringButton !== wasHoveringButton) {
                node.setDirtyCanvas(true);
            }
            return false;
        }

        if (event.type === "pointerdown") {
            // Check button click (open native color picker)
            if (this.isInBounds(pos, this.hitAreaButton)) {
                visibilityLogger.debug('[ColorPicker] Button clicked, opening native picker');

                const currentColor = this.fillColorWidget.value || "#808080";
                const normalizedColor = currentColor.startsWith('#') ? currentColor : '#' + currentColor;

                // Position picker near mouse click with offset to avoid obscuring node
                const PICKER_OFFSET_X = 100; // Offset to the right of click
                const PICKER_OFFSET_Y = 0;   // No vertical offset
                const PICKER_WIDTH = 50;     // Width of our input element
                const PICKER_HEIGHT = 50;    // Height of our input element
                const MARGIN = 20;           // Minimum margin from viewport edge

                let pickerX = event.clientX + PICKER_OFFSET_X;
                let pickerY = event.clientY + PICKER_OFFSET_Y;

                // Ensure picker stays within viewport bounds
                if (pickerX + PICKER_WIDTH + MARGIN > window.innerWidth) {
                    // Position to left of click instead if too close to right edge
                    pickerX = event.clientX - PICKER_OFFSET_X - PICKER_WIDTH;
                }
                if (pickerY + PICKER_HEIGHT + MARGIN > window.innerHeight) {
                    pickerY = window.innerHeight - PICKER_HEIGHT - MARGIN;
                }
                if (pickerX < MARGIN) {
                    pickerX = MARGIN;
                }
                if (pickerY < MARGIN) {
                    pickerY = MARGIN;
                }

                visibilityLogger.debug(`[ColorPicker] Mouse position: (${event.clientX}, ${event.clientY})`);
                visibilityLogger.debug(`[ColorPicker] Picker position with offset: (${pickerX}, ${pickerY})`);

                const colorInput = document.createElement("input");
                colorInput.type = "color";
                colorInput.value = normalizedColor;
                colorInput.style.position = "fixed";
                colorInput.style.left = pickerX + "px";
                colorInput.style.top = pickerY + "px";
                colorInput.style.width = "50px";
                colorInput.style.height = "50px";
                colorInput.style.border = "2px solid #666";
                colorInput.style.borderRadius = "4px";
                colorInput.style.cursor = "pointer";
                colorInput.style.zIndex = "10000";
                document.body.appendChild(colorInput);

                let pickerClosed = false;

                // Handle color selection
                const handleChange = (e) => {
                    if (pickerClosed) return;
                    pickerClosed = true;
                    this.fillColorWidget.value = e.target.value;
                    visibilityLogger.debug(`[ColorPicker] Color selected: ${e.target.value}`);
                    node.setDirtyCanvas(true, true);
                    if (colorInput.parentNode) {
                        document.body.removeChild(colorInput);
                    }
                };

                // Handle cancellation (ESC key or click outside)
                const handleCancel = (e) => {
                    if (pickerClosed) return;
                    // Give the picker time to fully open before allowing cancellation
                    setTimeout(() => {
                        if (pickerClosed) return;
                        if (e.type === 'keydown' && e.key === 'Escape') {
                            pickerClosed = true;
                            visibilityLogger.debug('[ColorPicker] Cancelled via ESC key');
                            if (colorInput.parentNode) {
                                document.body.removeChild(colorInput);
                            }
                        }
                    }, 200);
                };

                // Handle blur with delay to allow picker to open
                const handleBlur = () => {
                    setTimeout(() => {
                        if (pickerClosed) return;
                        if (colorInput.parentNode && document.activeElement !== colorInput) {
                            pickerClosed = true;
                            visibilityLogger.debug('[ColorPicker] Picker closed (blur)');
                            document.body.removeChild(colorInput);
                        }
                    }, 500);  // Longer delay to prevent immediate closure
                };

                colorInput.addEventListener("change", handleChange);
                colorInput.addEventListener("keydown", handleCancel);
                colorInput.addEventListener("blur", handleBlur);

                // Open native picker with delay to ensure DOM is ready
                setTimeout(() => {
                    if (!pickerClosed) {
                        colorInput.click();
                        colorInput.focus();
                    }
                }, 50);

                return true;
            }
        }

        return false;
    }

    isInBounds(pos, bounds) {
        if (!bounds) return false;  // Guard against undefined bounds
        return pos[0] >= bounds.x &&
               pos[0] <= bounds.x + bounds.width &&
               pos[1] >= bounds.y &&
               pos[1] <= bounds.y + bounds.height;
    }

    computeSize(width) {
        return [width, 28];
    }
}

export { ColorPickerButton };
