/**
 * @fileoverview Drag-and-drop reorder utility for Svelte 5.
 *
 * Uses the native HTML Drag and Drop API. Provides handlers that
 * can be spread onto draggable list items.
 *
 * @module utils/drag-reorder
 */

/** State for an active drag operation. */
export interface DragState {
	/** Index of the item being dragged. */
	dragIndex: number;
	/** Current drop target index. */
	overIndex: number;
}

/**
 * Creates drag event handlers for a reorderable list.
 *
 * @param onReorder - Callback with (fromIndex, toIndex) when a drop completes.
 * @returns An object with `dragState` and handler functions.
 *
 * @example
 * const drag = createDragHandlers((from, to) => reorderItems(from, to));
 * // In template:
 * <div
 *   draggable="true"
 *   ondragstart={(e) => drag.handleDragStart(e, index)}
 *   ondragover={(e) => drag.handleDragOver(e, index)}
 *   ondrop={(e) => drag.handleDrop(e)}
 *   ondragend={() => drag.handleDragEnd()}
 * >
 */
export function createDragHandlers(onReorder: (fromIndex: number, toIndex: number) => void) {
	let dragIndex = -1;
	let overIndex = -1;

	function handleDragStart(e: DragEvent, index: number): void {
		dragIndex = index;
		if (e.dataTransfer) {
			e.dataTransfer.effectAllowed = 'move';
			e.dataTransfer.setData('text/plain', String(index));
		}
		// Add a small delay to let the browser capture the drag image
		const target = e.currentTarget as HTMLElement;
		target.style.opacity = '0.5';
	}

	function handleDragOver(e: DragEvent, index: number): void {
		e.preventDefault();
		if (e.dataTransfer) {
			e.dataTransfer.dropEffect = 'move';
		}
		overIndex = index;
	}

	function handleDrop(e: DragEvent): void {
		e.preventDefault();
		if (dragIndex >= 0 && overIndex >= 0 && dragIndex !== overIndex) {
			onReorder(dragIndex, overIndex);
		}
		dragIndex = -1;
		overIndex = -1;
	}

	function handleDragEnd(e?: DragEvent): void {
		if (e) {
			const target = e.currentTarget as HTMLElement;
			target.style.opacity = '1';
		}
		dragIndex = -1;
		overIndex = -1;
	}

	function isDragging(): boolean {
		return dragIndex >= 0;
	}

	function isOver(index: number): boolean {
		return overIndex === index && dragIndex !== index;
	}

	function getDragIndex(): number {
		return dragIndex;
	}

	return {
		handleDragStart,
		handleDragOver,
		handleDrop,
		handleDragEnd,
		isDragging,
		isOver,
		getDragIndex,
	};
}
