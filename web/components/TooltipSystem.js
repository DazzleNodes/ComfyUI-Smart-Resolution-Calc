/**
 * Tooltip System — TooltipManager, InfoIcon, wrapWidgetWithTooltip
 *
 * EXACT COPY from smart_resolution_calc.js lines 293-731.
 * No interface changes — all exports match the original closure behavior.
 *
 * The tooltipManager singleton is created at module level and shared
 * via export, replacing the IIFE closure variable.
 */

import { logger } from '../utils/debug_logger.js';

// ============================================================================
// TooltipManager (was lines 293-603)
// ============================================================================

class TooltipManager {
    constructor() {
        this.activeTooltip = null;
        this.hoverStartTime = null;
        this.quickShown = false;
        this.fullShown = false;

        // Load config from localStorage
        this.config = this.loadConfig();
    }

    loadConfig() {
        try {
            const config = localStorage.getItem('smart-res-calc-tooltip-config');
            return config ? JSON.parse(config) : {
                showInfoIcons: true,
                defaultDelay: 250,
                fullDelay: 1500,
                advancedMode: false
            };
        } catch (e) {
            return { showInfoIcons: true, defaultDelay: 250, fullDelay: 1500 };
        }
    }

    saveConfig() {
        try {
            localStorage.setItem('smart-res-calc-tooltip-config', JSON.stringify(this.config));
            logger.debug('Saved tooltip config:', this.config);
        } catch (e) {
            logger.error('Failed to save tooltip config:', e);
        }
    }

    startHover(tooltipContent, iconBounds, canvasBounds, nodePos) {
        this.hoverStartTime = Date.now();

        const globalBounds = nodePos ? {
            x: iconBounds.x + nodePos[0],
            y: iconBounds.y + nodePos[1],
            width: iconBounds.width,
            height: iconBounds.height
        } : iconBounds;

        this.activeTooltip = {
            content: tooltipContent,
            bounds: globalBounds,
            position: null
        };
        this.quickShown = false;
        this.fullShown = false;
    }

    updateHover() {
        if (!this.activeTooltip) return;

        const elapsed = Date.now() - this.hoverStartTime;
        const delay = this.activeTooltip.content.hoverDelay || this.config.defaultDelay;

        if (!this.quickShown && elapsed >= delay) {
            this.quickShown = true;
        }

        if (!this.fullShown && elapsed >= this.config.fullDelay) {
            this.fullShown = true;
        }
    }

    endHover() {
        if (this.activeTooltip) {
        }
        this.activeTooltip = null;
        this.hoverStartTime = null;
        this.quickShown = false;
        this.fullShown = false;
    }

    calculateTooltipPosition(iconBounds, canvasBounds) {
        const tooltipWidth = 300;
        const tooltipHeight = 150;

        let x = iconBounds.x + iconBounds.width + 10;
        let y = iconBounds.y;

        if (canvasBounds && x + tooltipWidth > canvasBounds.width) {
            x = iconBounds.x - tooltipWidth - 10;
        }

        if (canvasBounds && y + tooltipHeight > canvasBounds.height) {
            y = Math.max(10, canvasBounds.height - tooltipHeight - 10);
        }

        return { x, y };
    }

    draw(ctx, canvasBounds) {
        if (!this.activeTooltip || !this.config.showInfoIcons) return;

        this.updateHover();

        const tooltip = this.activeTooltip;
        const pos = tooltip.position;

        let content = '';
        if (this.fullShown && tooltip.content.full) {
            content = tooltip.content.full;
        } else if (this.quickShown && tooltip.content.quick) {
            content = tooltip.content.quick;
        }

        if (!content) {
            return;
        }

        const padding = 12;
        const lineHeight = 16;
        const maxWidth = 280;

        const lines = this.wrapText(ctx, content, maxWidth - padding * 2);
        const tooltipHeight = lines.length * lineHeight + padding * 2;

        ctx.save();

        ctx.fillStyle = 'rgba(30, 30, 30, 0.95)';
        ctx.strokeStyle = '#4CAF50';
        ctx.lineWidth = 1;
        ctx.beginPath();
        if (ctx.roundRect) {
            ctx.roundRect(pos.x, pos.y, maxWidth, tooltipHeight, 4);
        } else {
            ctx.rect(pos.x, pos.y, maxWidth, tooltipHeight);
        }
        ctx.fill();
        ctx.stroke();

        ctx.fillStyle = '#ffffff';
        ctx.font = '12px sans-serif';
        ctx.textBaseline = 'top';

        lines.forEach((line, i) => {
            ctx.fillText(line, pos.x + padding, pos.y + padding + i * lineHeight);
        });

        if (this.fullShown && tooltip.content.docsUrl) {
            const linkY = pos.y + tooltipHeight - padding - lineHeight;
            ctx.fillStyle = '#4CAF50';
            ctx.font = 'bold 11px sans-serif';
            ctx.fillText('Click icon for full docs →', pos.x + padding, linkY);
        }

        ctx.restore();
    }

    drawAtScreenCoords(ctx, screenBounds, canvasBounds) {
        if (!this.activeTooltip || !this.config.showInfoIcons) return;

        this.updateHover();

        const tooltip = this.activeTooltip;

        logger.verbose(`quickShown: ${this.quickShown}, fullShown: ${this.fullShown}`);

        let content = '';
        if (this.fullShown && tooltip.content.full) {
            content = tooltip.content.full;
        } else if (this.quickShown && tooltip.content.quick) {
            content = tooltip.content.quick;
        }

        if (!content) {
            return;
        }

        const tooltipWidth = 280;
        const tooltipHeight = 150;

        let x = screenBounds.x + screenBounds.width + 10;
        let y = screenBounds.y;

        if (x + tooltipWidth > canvasBounds.width) {
            x = screenBounds.x - tooltipWidth - 10;
        }

        if (y + tooltipHeight > canvasBounds.height) {
            y = Math.max(10, canvasBounds.height - tooltipHeight - 10);
        }

        const padding = 12;
        const lineHeight = 16;
        const maxWidth = 280;

        const lines = this.wrapText(ctx, content, maxWidth - padding * 2);

        const hasDocLink = this.fullShown && tooltip.content.docsUrl;
        const contentLines = lines.length + (hasDocLink ? 1 : 0);
        const actualTooltipHeight = contentLines * lineHeight + padding * 2;

        if (y + actualTooltipHeight > canvasBounds.height) {
            y = Math.max(10, canvasBounds.height - actualTooltipHeight - 10);
        }

        ctx.save();

        ctx.fillStyle = 'rgba(30, 30, 30, 0.95)';
        ctx.strokeStyle = '#4CAF50';
        ctx.lineWidth = 1;
        ctx.beginPath();
        if (ctx.roundRect) {
            ctx.roundRect(x, y, maxWidth, actualTooltipHeight, 4);
        } else {
            ctx.rect(x, y, maxWidth, actualTooltipHeight);
        }
        ctx.fill();
        ctx.stroke();

        ctx.fillStyle = '#ffffff';
        ctx.font = '12px sans-serif';
        ctx.textBaseline = 'top';

        lines.forEach((line, i) => {
            ctx.fillText(line, x + padding, y + padding + i * lineHeight);
        });

        if (hasDocLink) {
            const linkY = y + padding + lines.length * lineHeight;
            ctx.fillStyle = '#4CAF50';
            ctx.font = 'bold 11px sans-serif';
            ctx.fillText('Shift+Click label for full docs →', x + padding, linkY);
        }

        ctx.restore();
    }

    wrapText(ctx, text, maxWidth) {
        const lines = [];
        const paragraphs = text.split('\n');

        ctx.font = '12px sans-serif';

        paragraphs.forEach(paragraph => {
            if (!paragraph.trim()) {
                lines.push('');
                return;
            }

            const words = paragraph.split(' ');
            let currentLine = '';

            words.forEach(word => {
                const testLine = currentLine + (currentLine ? ' ' : '') + word;
                const metrics = ctx.measureText(testLine);

                if (metrics.width > maxWidth && currentLine) {
                    lines.push(currentLine);
                    currentLine = word;
                } else {
                    currentLine = testLine;
                }
            });

            if (currentLine) {
                lines.push(currentLine);
            }
        });

        return lines;
    }

    handleClick(tooltipContent) {
        if (tooltipContent.docsUrl) {
            window.open(tooltipContent.docsUrl, '_blank');
            logger.info('Opened docs:', tooltipContent.docsUrl);
        } else {
            logger.debug('No docs URL available for this tooltip');
        }
    }
}

// ============================================================================
// InfoIcon (was lines 619-693)
// ============================================================================

class InfoIcon {
    constructor(tooltipContent) {
        this.content = tooltipContent;
        this.hitArea = { x: 0, y: 0, width: 0, height: 0 };
        this.isHovering = false;
    }

    setHitArea(x, y, width, height) {
        if (!tooltipManager.config.showInfoIcons) return;
        this.hitArea = { x, y, width, height };
    }

    /**
     * Legacy draw method - now just calls setHitArea for backwards compatibility
     * @deprecated Use setHitArea() instead
     */
    draw(ctx, x, y, height, canvasBounds) {
        this.setHitArea(x, y, 14, height);
    }

    mouse(event, pos, canvasBounds, nodePos) {
        if (!tooltipManager.config.showInfoIcons) return false;

        const inBounds = this.isInBounds(pos, this.hitArea);

        if (event.type === 'pointermove') {
            if (inBounds && !this.isHovering) {
                this.isHovering = true;
                tooltipManager.startHover(this.content, this.hitArea, canvasBounds, nodePos);
                return true;
            } else if (!inBounds && this.isHovering) {
                this.isHovering = false;
                tooltipManager.endHover();
                return false;
            }
        }

        if (event.type === 'pointerdown' && inBounds) {
            if (event.shiftKey) {
                tooltipManager.handleClick(this.content);
                return true;
            }
            return false;
        }

        return inBounds;
    }

    isInBounds(pos, bounds) {
        if (!bounds) return false;
        return pos[0] >= bounds.x &&
               pos[0] <= bounds.x + bounds.width &&
               pos[1] >= bounds.y &&
               pos[1] <= bounds.y + bounds.height;
    }
}

// ============================================================================
// Singleton + utility function (was lines 695-731)
// ============================================================================

// Singleton instance — replaces the IIFE closure variable
const tooltipManager = new TooltipManager();

/**
 * Add tooltip support to a native ComfyUI widget
 */
function wrapWidgetWithTooltip(widget, tooltipContent, node) {
    widget.infoIcon = new InfoIcon(tooltipContent);

    const originalMouse = widget.mouse;

    widget.mouse = function(event, pos, node) {
        if (this.infoIcon) {
            const canvasBounds = { width: node.size[0], height: node.size[1] };
            const tooltipHandled = this.infoIcon.mouse(event, pos, canvasBounds, node.pos);
            if (tooltipHandled) {
                node.setDirtyCanvas(true);
                return true;
            }
        }

        if (originalMouse) {
            return originalMouse.call(this, event, pos, node);
        }
        return false;
    };
}

// ============================================================================
// Exports — exact same interface as the original closure provided
// ============================================================================

export { TooltipManager, InfoIcon, tooltipManager, wrapWidgetWithTooltip };
