/**
 * CopyImageButton -- button that copies dimensions from connected image
 *
 * Extracted from smart_resolution_calc.js (Phase 10 refactor).
 *
 * Dependencies:
 * - ImageDimensionUtils from ImageDimensionUtils.js
 * - logger from debug_logger.js
 * - app (ComfyUI global) -- accessed at runtime
 */

import { ImageDimensionUtils } from '../utils/ImageDimensionUtils.js';
import { logger } from '../utils/debug_logger.js';


/**
 * Copy from Image Button Widget
 * Simple button to extract dimensions from connected image and populate widgets
 */
class CopyImageButton {
    constructor(name = "copy_from_image") {
        this.name = name;
        this.type = "custom";  // Must be "custom" for addCustomWidget to route mouse events
        this.value = null;  // Buttons don't need a value

        // Undo state
        this.undoStack = null;  // Stores previous values: {width: {on, value}, height: {on, value}}
        this.showUndo = false;  // Show undo button after copy

        // Hover states
        this.isHoveringCopy = false;
        this.isHoveringUndo = false;
    }

    draw(ctx, node, width, y, height) {
        ctx.save();

        const x = 15;  // Standard widget left margin
        const margin = 3;  // Space between buttons
        const buttonHeight = 28;

        // Check if image is connected
        const imageInput = node.inputs ? node.inputs.find(i => i.name === "image") : null;
        const hasImage = imageInput && imageInput.link != null;

        // Layout: [Copy Button] [Undo Button] if showUndo
        const undoButtonWidth = this.showUndo ? 60 : 0;
        const copyButtonWidth = this.showUndo
            ? width - 30 - undoButtonWidth - margin  // Leave space for undo
            : width - 30;  // Full width

        // === Draw Copy Button ===

        // Copy button style
        if (hasImage) {
            ctx.fillStyle = this.isHoveringCopy ? "#4a7a9a" : "#3a5a7a";
        } else {
            ctx.fillStyle = "#2a2a2a";
        }

        // Copy button background
        ctx.beginPath();
        ctx.roundRect(x, y, copyButtonWidth, buttonHeight, 4);
        ctx.fill();

        // Copy button border
        ctx.strokeStyle = hasImage ? "#5a8aaa" : "#3a3a3a";
        ctx.lineWidth = 1;
        ctx.stroke();

        // Copy button text
        // DEPRECATED (v0.6.1+): The (No Image) state text should now be unreachable because
        // this widget is auto-hidden when image input is disconnected. Preserved as defensive
        // fallback in case visibility system has edge cases or is disabled in future.
        ctx.fillStyle = hasImage ? "#ffffff" : "#666666";
        ctx.font = "12px sans-serif";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        const text = hasImage ? "📋 Copy from Image" : "📋 Copy from Image (No Image)";
        ctx.fillText(text, x + copyButtonWidth / 2, y + buttonHeight / 2);

        // Store copy button hit area
        this.hitAreaCopy = { x, y, width: copyButtonWidth, height: buttonHeight };

        // === Draw Undo Button (if available) ===

        if (this.showUndo) {
            const undoX = x + copyButtonWidth + margin;

            // Undo button style
            ctx.fillStyle = this.isHoveringUndo ? "#9a4a4a" : "#7a3a3a";

            // Undo button background
            ctx.beginPath();
            ctx.roundRect(undoX, y, undoButtonWidth, buttonHeight, 4);
            ctx.fill();

            // Undo button border
            ctx.strokeStyle = "#aa5a5a";
            ctx.lineWidth = 1;
            ctx.stroke();

            // Undo button text
            ctx.fillStyle = "#ffffff";
            ctx.font = "12px sans-serif";
            ctx.textAlign = "center";
            ctx.textBaseline = "middle";
            ctx.fillText("↶ Undo", undoX + undoButtonWidth / 2, y + buttonHeight / 2);

            // Store undo button hit area
            this.hitAreaUndo = { x: undoX, y, width: undoButtonWidth, height: buttonHeight };
        } else {
            this.hitAreaUndo = null;
        }

        ctx.restore();
    }

    mouse(event, pos, node) {
        if (event.type === "pointermove") {
            // Check hover state for both buttons
            const wasHoveringCopy = this.isHoveringCopy;
            const wasHoveringUndo = this.isHoveringUndo;

            this.isHoveringCopy = this.isInBounds(pos, this.hitAreaCopy);
            this.isHoveringUndo = this.hitAreaUndo && this.isInBounds(pos, this.hitAreaUndo);

            if (this.isHoveringCopy !== wasHoveringCopy || this.isHoveringUndo !== wasHoveringUndo) {
                node.setDirtyCanvas(true);
            }
            return false;
        }

        if (event.type === "pointerdown") {

            // Check Copy button click
            const inCopyBounds = this.isInBounds(pos, this.hitAreaCopy);
            if (inCopyBounds) {
                logger.debug("Copy button clicked");
                // Check if image is connected
                const imageInput = node.inputs ? node.inputs.find(i => i.name === "image") : null;
                if (imageInput && imageInput.link != null) {
                    logger.debug("Image connected - calling copyFromImage");
                    // Get the connected node
                    const link = node.graph.links[imageInput.link];
                    if (link) {
                        const sourceNode = node.graph.getNodeById(link.origin_id);
                        if (sourceNode) {
                            // Try to get image from source node's last execution
                            this.copyFromImage(node, sourceNode);
                        }
                    }
                } else {
                    logger.debug("No image connected - button disabled");
                }
                node.setDirtyCanvas(true);
                return true;
            }

            // Check Undo button click
            const inUndoBounds = this.hitAreaUndo && this.isInBounds(pos, this.hitAreaUndo);
            if (inUndoBounds) {
                logger.debug("Undo button clicked");
                this.undoCopy(node);
                return true;
            }

        }

        if (event.type === "pointerup") {
            if (this.isHoveringCopy || this.isHoveringUndo) {
                this.isHoveringCopy = false;
                this.isHoveringUndo = false;
                node.setDirtyCanvas(true);
            }
        }

        return false;
    }

    /**
     * Hybrid B+C Copy Strategy
     * Tier 1: Server endpoint (immediate for Load Image nodes)
     * Tier 2: Parse info output (post-execution caching)
     * Tier 3: Instructions dialog (user guidance)
     */
    async copyFromImage(node, sourceNode) {
        logger.info("===== COPY FROM IMAGE CLICKED =====");
        logger.debug("Copy from Image clicked! Starting hybrid B+C strategy...");
        logger.debug(`Source node:`, sourceNode);
        logger.debug(`Source node type: ${sourceNode?.type}`);

        // Tier 1: Try server endpoint for Load Image nodes
        try {
            const filePath = this.getImageFilePath(sourceNode);
            if (filePath) {
                logger.debug(`Attempting server endpoint with path: ${filePath}`);
                const dims = await this.fetchDimensionsFromServer(filePath);
                if (dims && dims.success) {
                    logger.debug(`Server success: ${dims.width}×${dims.height}`);
                    this.populateWidgets(node, dims.width, dims.height);
                    this.showSuccessNotification(node, dims.width, dims.height, "File");
                    return;
                }
                logger.debug("Server endpoint failed or returned no data");
            }
        } catch (e) {
            logger.debug(`Server endpoint error: ${e.message}`);
        }

        // Tier 2: Try parsing cached info output
        try {
            const dims = this.parseDimensionsFromInfo(node);
            if (dims) {
                logger.debug(`Info parsing success: ${dims.width}×${dims.height}`);
                this.populateWidgets(node, dims.width, dims.height);
                this.showSuccessNotification(node, dims.width, dims.height, "Cached");
                return;
            }
            logger.debug("No cached info output found");
        } catch (e) {
            logger.debug(`Info parsing error: ${e.message}`);
        }

        // Tier 3: Fallback - show instructions
        logger.debug("All methods failed - showing instructions");
        this.showInstructionsDialog();
    }

    /**
     * Extract file path from LoadImage node (delegates to shared utils)
     */
    getImageFilePath(sourceNode) {
        return ImageDimensionUtils.getImageFilePath(sourceNode);
    }

    /**
     * Fetch dimensions from server endpoint (delegates to shared utils)
     */
    async fetchDimensionsFromServer(imagePath) {
        return await ImageDimensionUtils.fetchDimensionsFromServer(imagePath);
    }

    /**
     * Parse dimensions from cached info output (delegates to shared utils)
     */
    parseDimensionsFromInfo(node) {
        return ImageDimensionUtils.parseDimensionsFromInfo(node);
    }

    /**
     * Populate dimension widgets with extracted values
     * IMPORTANT: Only updates VALUES, preserves user's ON/OFF toggle states
     * User decides which calculation mode to use (MP, W+H, W+AR, etc.)
     */
    populateWidgets(node, width, height) {
        logger.debug(`Populating widgets: ${width}×${height}`);

        // Find the dimension widgets
        const widthWidget = node.widgets?.find(w => w.name === "dimension_width");
        const heightWidget = node.widgets?.find(w => w.name === "dimension_height");

        if (!widthWidget || !heightWidget) {
            logger.error("Could not find dimension widgets!");
            return;
        }

        // Save current values to undo stack BEFORE changing
        this.undoStack = {
            width: { ...widthWidget.value },
            height: { ...heightWidget.value }
        };
        this.showUndo = true;
        logger.debug('Saved undo state:', this.undoStack);

        // ONLY update values - preserve user's toggle states
        // User may want dimensions copied but still use MP+AR calculation
        widthWidget.value = { on: widthWidget.value.on, value: width };
        heightWidget.value = { on: heightWidget.value.on, value: height };

        logger.debug(`Updated WIDTH=${width} (toggle: ${widthWidget.value.on ? 'ON' : 'OFF'})`);
        logger.debug(`Updated HEIGHT=${height} (toggle: ${heightWidget.value.on ? 'ON' : 'OFF'})`);

        // Mark node as modified and refresh canvas
        node.setDirtyCanvas(true, true);
        logger.debug("Widgets populated successfully (preserved user's toggle states)");
    }

    /**
     * Undo the last copy operation
     * Restores previous WIDTH/HEIGHT values (including toggle states)
     */
    undoCopy(node) {
        if (!this.undoStack) {
            logger.debug('No undo state available');
            return;
        }

        logger.debug('Restoring undo state:', this.undoStack);

        // Find the dimension widgets
        const widthWidget = node.widgets?.find(w => w.name === "dimension_width");
        const heightWidget = node.widgets?.find(w => w.name === "dimension_height");

        if (!widthWidget || !heightWidget) {
            logger.error("Could not find dimension widgets for undo!");
            return;
        }

        // Restore previous values (including toggle states)
        widthWidget.value = { ...this.undoStack.width };
        heightWidget.value = { ...this.undoStack.height };

        logger.info(`↶ Undone: Restored WIDTH=${this.undoStack.width.value} (${this.undoStack.width.on ? 'ON' : 'OFF'}), HEIGHT=${this.undoStack.height.value} (${this.undoStack.height.on ? 'ON' : 'OFF'})`);

        // Clear undo state and hide button
        this.undoStack = null;
        this.showUndo = false;

        // Mark node as modified and refresh canvas
        node.setDirtyCanvas(true, true);
    }

    /**
     * Show success notification
     */
    showSuccessNotification(node, width, height, source) {
        const gcd = (a, b) => b === 0 ? a : gcd(b, a % b);
        const divisor = gcd(width, height);
        const aspectRatio = `${width/divisor}:${height/divisor}`;

        logger.info(`✓ Copied from ${source}: ${width}×${height} (${aspectRatio})`);

        // Optional: Could show a brief toast notification here
        // For now, the log message is sufficient
    }

    /**
     * Show instructions dialog (Tier 3 fallback)
     */
    showInstructionsDialog() {
        const canvas = app.canvas;
        canvas.prompt(
            "Copy Image Dimensions",
            "To copy dimensions:\n\n1. Run the workflow once (Queue Prompt)\n2. After execution, click this button again\n3. Cached dimensions will be extracted\n\nOr manually enter width and height from your source image.\n\n(Server endpoint requires Load Image node with file path)",
            null,
            event
        );
        logger.debug("Showing instructions dialog (all auto-methods failed)");
    }

    isInBounds(pos, bounds) {
        if (!bounds) return false;
        return pos[0] >= bounds.x &&
               pos[0] <= bounds.x + bounds.width &&
               pos[1] >= bounds.y &&
               pos[1] <= bounds.y + bounds.height;
    }

    computeSize(width) {
        return [width, 32];  // Button height
    }

    serializeValue(node, index) {
        // Buttons don't serialize - they're action triggers
        return undefined;
    }
}

export { CopyImageButton };
