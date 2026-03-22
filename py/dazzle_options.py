"""
DazzleOptions — Advanced configuration node for SmartResCalc.

Provides optional advanced settings that control spectral blend behavior,
normalization algorithms, and other advanced features. Connects to
SmartResCalc's `dazzle_options` input.

Architecture:
- DAZZLE_OPTIONS is a plain Python dict (no custom class)
- options_in enables chaining (compositor pattern)
- Unknown keys silently ignored (forward-compatible)
- No connection = all defaults (backward compatible)
"""

import logging

logger = logging.getLogger(__name__)


class DazzleOptionsNode:
    """Advanced configuration node for SmartResCalc spectral blend and noise features.

    Connect to SmartResCalc's dazzle_options input to override default behavior.
    Without this node connected, SmartResCalc uses context-aware defaults.

    Chain multiple DazzleOptions nodes via options_in for modular configuration.
    """

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {},
            "optional": {
                "norm_mode": (["auto", "per_bin", "global_rms"], {
                    "default": "auto",
                    "tooltip": "Spectral normalization algorithm.\n\n"
                               "auto: SmartResCalc picks based on context "
                               "(per_bin for images, global_rms for noise patterns)\n\n"
                               "per_bin: Each frequency bin normalized individually. "
                               "Transfers spatial structure via phase only. "
                               "Resolution-independent, works well at any image size.\n\n"
                               "global_rms: All bins scaled by same factor (v0.10.4 behavior). "
                               "Preserves amplitude structure but can overwhelm at high resolution. "
                               "Use this to reproduce outputs from older versions."
                }),
                "whitening": ("FLOAT", {
                    "default": 1.0,
                    "min": 0.0,
                    "max": 1.0,
                    "step": 0.1,
                    "tooltip": "Blend between global_rms (0.0) and per_bin (1.0) normalization. "
                               "Only used when norm_mode is 'auto' or for fine-tuning. "
                               "0.0 = full amplitude transfer (old behavior). "
                               "1.0 = phase-only transfer (new behavior). "
                               "0.5 = half amplitude, half phase."
                }),
                "cutoff_curve": (["gaussian", "cosine", "sharp"], {
                    "default": "gaussian",
                    "tooltip": "Shape of the frequency rolloff mask.\n\n"
                               "gaussian: Smooth Gaussian rolloff (default, avoids Gibbs ringing)\n"
                               "cosine: Cosine rolloff (slightly sharper transition)\n"
                               "sharp: Brick-wall cutoff (sharpest, may cause ringing artifacts)"
                }),
                "phase_randomize": ("BOOLEAN", {
                    "default": False,
                    "tooltip": "Randomize pattern phases before blending. "
                               "Decorrelates pattern from samples in img2img+img2noise mode. "
                               "Preserves spatial structure (amplitude) while breaking "
                               "pixel-level correlation."
                }),
                "options_in": ("DAZZLE_OPTIONS", {
                    "tooltip": "Chain input from another DazzleOptions node. "
                               "Options from this node override values from options_in."
                }),
            }
        }

    RETURN_TYPES = ("DAZZLE_OPTIONS",)
    RETURN_NAMES = ("options",)
    FUNCTION = "configure"
    CATEGORY = "DazzleNodes/Options"

    def configure(self, norm_mode="auto", whitening=1.0, cutoff_curve="gaussian",
                  phase_randomize=False, options_in=None):
        """Build options dict, merging with any chained input."""
        # Start with chained options (if any)
        opts = dict(options_in or {})

        # Override with this node's values
        opts.update({
            "norm_mode": norm_mode,
            "whitening": whitening,
            "cutoff_curve": cutoff_curve,
            "phase_randomize": phase_randomize,
        })

        logger.debug(f"DazzleOptions configured: {opts}")
        return (opts,)


# Convenience function for consuming options with defaults
def get_option(dazzle_options, key, default=None):
    """Safely get an option value with a default.

    Args:
        dazzle_options: The DAZZLE_OPTIONS dict (may be None)
        key: Option key to look up
        default: Default value if key not found or options is None

    Returns:
        The option value or default
    """
    if dazzle_options is None:
        return default
    return dazzle_options.get(key, default)
