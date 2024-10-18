/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { compareBy } from '../../../base/common/arrays.js';
import { findLastMax, findFirstMin } from '../../../base/common/arraysFind.js';
import { CursorState, PartialCursorState } from '../cursorCommon.js';
import { CursorContext } from './cursorContext.js';
import { Cursor } from './oneCursor.js';
import { Position } from '../core/position.js';
import { Range } from '../core/range.js';
import { ISelection, Selection } from '../core/selection.js';

export class CursorCollection {

	// 存储光标操作的上下文信息
	private context: CursorContext;

	/**
	 * `cursors[0]` is the primary cursor, thus `cursors.length >= 1` is always true.
	 * `cursors.slice(1)` are secondary cursors.
	 *
	 * `cursors[0]` 是主光标，`cursors.length >= 1` 始终为真。
	 * `cursors.slice(1)` 是次要光标。
	*/
	private cursors: Cursor[];

	// An index which identifies the last cursor that was added / moved (think Ctrl+drag)
	// This index refers to `cursors.slice(1)`, i.e. after removing the primary cursor.
	// 标识最后添加/移动的光标的索引（不包括主光标）
	private lastAddedCursorIndex: number;

	constructor(context: CursorContext) {
		this.context = context;
		// 初始化时创建一个主光标
		this.cursors = [new Cursor(context)];
		this.lastAddedCursorIndex = 0;
	}

	public dispose(): void {
		for (const cursor of this.cursors) {
			cursor.dispose(this.context);
		}
	}

	public startTrackingSelections(): void {
		for (const cursor of this.cursors) {
			cursor.startTrackingSelection(this.context);
		}
	}

	public stopTrackingSelections(): void {
		for (const cursor of this.cursors) {
			cursor.stopTrackingSelection(this.context);
		}
	}

	public updateContext(context: CursorContext): void {
		this.context = context;
	}

	public ensureValidState(): void {
		for (const cursor of this.cursors) {
			cursor.ensureValidState(this.context);
		}
	}

	public readSelectionFromMarkers(): Selection[] {
		return this.cursors.map(c => c.readSelectionFromMarkers(this.context));
	}

	// 获取所有光标的状态
	public getAll(): CursorState[] {
		return this.cursors.map(c => c.asCursorState());
	}

	// 获取所有光标的视图位置
	public getViewPositions(): Position[] {
		return this.cursors.map(c => c.viewState.position);
	}

	public getTopMostViewPosition(): Position {
		return findFirstMin(
			this.cursors,
			compareBy(c => c.viewState.position, Position.compare)
		)!.viewState.position;
	}

	public getBottomMostViewPosition(): Position {
		return findLastMax(
			this.cursors,
			compareBy(c => c.viewState.position, Position.compare)
		)!.viewState.position;
	}

	// 获取所有光标的选择
	public getSelections(): Selection[] {
		return this.cursors.map(c => c.modelState.selection);
	}

	// 获取所有光标的视图选择
	public getViewSelections(): Selection[] {
		return this.cursors.map(c => c.viewState.selection);
	}

	// 设置所有光标的选择
	public setSelections(selections: ISelection[]): void {
		this.setStates(CursorState.fromModelSelections(selections));
	}

	// 获取主光标
	public getPrimaryCursor(): CursorState {
		return this.cursors[0].asCursorState();
	}

	// 设置所有光标的状态
	public setStates(states: PartialCursorState[] | null): void {
		if (states === null) {
			return;
		}
		// 设置主光标状态
		this.cursors[0].setState(this.context, states[0].modelState, states[0].viewState);
		// 设置次要光标状态
		this._setSecondaryStates(states.slice(1));
	}

	/**
	 * Creates or disposes secondary cursors as necessary to match the number of `secondarySelections`.
	 * 根据需要创建或删除次要光标，以匹配 `secondarySelections` 的数量。
	 */
	private _setSecondaryStates(secondaryStates: PartialCursorState[]): void {
		const secondaryCursorsLength = this.cursors.length - 1;
		const secondaryStatesLength = secondaryStates.length;

		if (secondaryCursorsLength < secondaryStatesLength) {
			const createCnt = secondaryStatesLength - secondaryCursorsLength;
			for (let i = 0; i < createCnt; i++) {
				this._addSecondaryCursor();
			}
		} else if (secondaryCursorsLength > secondaryStatesLength) {
			const removeCnt = secondaryCursorsLength - secondaryStatesLength;
			for (let i = 0; i < removeCnt; i++) {
				this._removeSecondaryCursor(this.cursors.length - 2);
			}
		}

		for (let i = 0; i < secondaryStatesLength; i++) {
			this.cursors[i + 1].setState(this.context, secondaryStates[i].modelState, secondaryStates[i].viewState);
		}
	}

	// 删除所有次要光标
	public killSecondaryCursors(): void {
		this._setSecondaryStates([]);
	}

	// 添加一个次要光标
	private _addSecondaryCursor(): void {
		this.cursors.push(new Cursor(this.context));
		this.lastAddedCursorIndex = this.cursors.length - 1;
	}

	// 获取最后添加的光标的索引
	public getLastAddedCursorIndex(): number {
		if (this.cursors.length === 1 || this.lastAddedCursorIndex === 0) {
			return 0;
		}
		return this.lastAddedCursorIndex;
	}

	// 删除一个次要光标
	private _removeSecondaryCursor(removeIndex: number): void {
		if (this.lastAddedCursorIndex >= removeIndex + 1) {
			this.lastAddedCursorIndex--;
		}
		this.cursors[removeIndex + 1].dispose(this.context);
		this.cursors.splice(removeIndex + 1, 1);
	}

	// 规范化光标，处理重叠的光标
	public normalize(): void {
		if (this.cursors.length === 1) {
			return;
		}
		const cursors = this.cursors.slice(0);

		interface SortedCursor {
			index: number;
			selection: Selection;
		}
		const sortedCursors: SortedCursor[] = [];
		for (let i = 0, len = cursors.length; i < len; i++) {
			sortedCursors.push({
				index: i,
				selection: cursors[i].modelState.selection,
			});
		}

		sortedCursors.sort(compareBy(s => s.selection, Range.compareRangesUsingStarts));

		for (let sortedCursorIndex = 0; sortedCursorIndex < sortedCursors.length - 1; sortedCursorIndex++) {
			const current = sortedCursors[sortedCursorIndex];
			const next = sortedCursors[sortedCursorIndex + 1];

			const currentSelection = current.selection;
			const nextSelection = next.selection;

			if (!this.context.cursorConfig.multiCursorMergeOverlapping) {
				continue;
			}

			let shouldMergeCursors: boolean;
			if (nextSelection.isEmpty() || currentSelection.isEmpty()) {
				// Merge touching cursors if one of them is collapsed
				shouldMergeCursors = nextSelection.getStartPosition().isBeforeOrEqual(currentSelection.getEndPosition());
			} else {
				// Merge only overlapping cursors (i.e. allow touching ranges)
				shouldMergeCursors = nextSelection.getStartPosition().isBefore(currentSelection.getEndPosition());
			}

			if (shouldMergeCursors) {
				const winnerSortedCursorIndex = current.index < next.index ? sortedCursorIndex : sortedCursorIndex + 1;
				const looserSortedCursorIndex = current.index < next.index ? sortedCursorIndex + 1 : sortedCursorIndex;

				const looserIndex = sortedCursors[looserSortedCursorIndex].index;
				const winnerIndex = sortedCursors[winnerSortedCursorIndex].index;

				const looserSelection = sortedCursors[looserSortedCursorIndex].selection;
				const winnerSelection = sortedCursors[winnerSortedCursorIndex].selection;

				if (!looserSelection.equalsSelection(winnerSelection)) {
					const resultingRange = looserSelection.plusRange(winnerSelection);
					const looserSelectionIsLTR = (looserSelection.selectionStartLineNumber === looserSelection.startLineNumber && looserSelection.selectionStartColumn === looserSelection.startColumn);
					const winnerSelectionIsLTR = (winnerSelection.selectionStartLineNumber === winnerSelection.startLineNumber && winnerSelection.selectionStartColumn === winnerSelection.startColumn);

					// Give more importance to the last added cursor (think Ctrl-dragging + hitting another cursor)
					let resultingSelectionIsLTR: boolean;
					if (looserIndex === this.lastAddedCursorIndex) {
						resultingSelectionIsLTR = looserSelectionIsLTR;
						this.lastAddedCursorIndex = winnerIndex;
					} else {
						// Winner takes it all
						resultingSelectionIsLTR = winnerSelectionIsLTR;
					}

					let resultingSelection: Selection;
					if (resultingSelectionIsLTR) {
						resultingSelection = new Selection(resultingRange.startLineNumber, resultingRange.startColumn, resultingRange.endLineNumber, resultingRange.endColumn);
					} else {
						resultingSelection = new Selection(resultingRange.endLineNumber, resultingRange.endColumn, resultingRange.startLineNumber, resultingRange.startColumn);
					}

					sortedCursors[winnerSortedCursorIndex].selection = resultingSelection;
					const resultingState = CursorState.fromModelSelection(resultingSelection);
					cursors[winnerIndex].setState(this.context, resultingState.modelState, resultingState.viewState);
				}

				for (const sortedCursor of sortedCursors) {
					if (sortedCursor.index > looserIndex) {
						sortedCursor.index--;
					}
				}

				cursors.splice(looserIndex, 1);
				sortedCursors.splice(looserSortedCursorIndex, 1);
				this._removeSecondaryCursor(looserIndex - 1);

				sortedCursorIndex--;
			}
		}
	}
}
