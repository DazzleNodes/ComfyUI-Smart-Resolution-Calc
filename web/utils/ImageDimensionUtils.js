/**
 * ImageDimensionUtils -- shared utilities for image dimension extraction
 *
 * Extracted from smart_resolution_calc.js (Phase 6 refactor, prerequisite).
 * Used by both ScaleWidget and CopyImageButton.
 */

import { logger } from './debug_logger.js';

const ImageDimensionUtils = {
    /**
     * Extract file path from LoadImage node
     * Returns null if not a LoadImage node or path not found
     */
    getImageFilePath(sourceNode, maxDepth = 10) {
        if (!sourceNode) return null;

        // Generic traversal: Follow input connections until we find a node with image data
        // This works with ANY node type (LoadImage, custom loaders, reroutes, etc.)
        let currentNode = sourceNode;
        let depth = 0;
        const visitedNodes = new Set();

        while (depth < maxDepth) {
            // Prevent circular references
            if (visitedNodes.has(currentNode.id)) {
                logger.verbose('[ImageUtils] Circular reference detected in connection chain');
                return null;
            }
            visitedNodes.add(currentNode.id);

            // Check if this node has an image widget with a filename
            // This works for LoadImage and any other node that loads images from files
            const imageWidget = currentNode.widgets?.find(w => w.name === "image");
            if (imageWidget && imageWidget.value) {
                logger.verbose(`[ImageUtils] Found image source at node '${currentNode.title || currentNode.type}' with filename: ${imageWidget.value}`);
                return imageWidget.value;
            }

            // This node doesn't have the data we need - check if it has an input to traverse
            // This handles reroutes, custom passthrough nodes, etc.
            const firstInput = currentNode.inputs?.[0];
            if (firstInput && firstInput.link) {
                const linkInfo = currentNode.graph.links[firstInput.link];
                const upstreamNode = linkInfo ? currentNode.graph.getNodeById(linkInfo.origin_id) : null;
                if (upstreamNode) {
                    logger.verbose(`[ImageUtils] Node '${currentNode.title || currentNode.type}' has no image data, traversing to input (depth ${depth})`);
                    currentNode = upstreamNode;
                    depth++;
                    continue;
                }
            }

            // No image data and no input to traverse
            logger.verbose(`[ImageUtils] Node '${currentNode.title || currentNode.type}' has no image data and no input connection`);
            return null;
        }

        logger.verbose(`[ImageUtils] Max depth (${maxDepth}) exceeded in connection chain`);
        return null;
    },

    /**
     * Fetch dimensions from server endpoint
     * Returns {width, height, success} or null on failure
     */
    async fetchDimensionsFromServer(imagePath) {
        try {
            const response = await fetch('/smart-resolution/get-dimensions', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({ image_path: imagePath })
            });

            if (!response.ok) {
                logger.verbose(`Server responded with status: ${response.status}`);
                return null;
            }

            const data = await response.json();
            return data;
        } catch (e) {
            logger.verbose(`Server request failed: ${e}`);
            return null;
        }
    },

    /**
     * Parse dimensions from cached info output
     * Looks for patterns like "From Image (Exact: 1920×1080)" or "From Image (AR: 16:9)"
     * Returns {width, height, success: true} or null
     */
    parseDimensionsFromInfo(node) {
        // Get the info widget value (last execution output)
        const infoWidget = node.widgets?.find(w => w.name === "info");
        if (!infoWidget || !infoWidget.value) {
            logger.verbose("No info widget or value found for dimension parsing");
            return null;
        }

        const infoText = infoWidget.value;
        logger.verbose(`Parsing info text: ${infoText}`);

        // Pattern: "From Image (Exact: 1920×1080)" or "From Image (AR: 16:9)"
        // Extract the source dimensions
        const match = infoText.match(/From Image \((?:Exact|AR): (\d+)×(\d+)\)/);
        if (match) {
            return {
                width: parseInt(match[1]),
                height: parseInt(match[2]),
                success: true
            };
        }

        logger.verbose("No dimension pattern found in info text");
        return null;
    }
};

export { ImageDimensionUtils };
