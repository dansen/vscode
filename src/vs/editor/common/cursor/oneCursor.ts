/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { CursorState, ICursorSimpleModel, SelectionStartKind, SingleCursorState } from '../cursorCommon.js';
import { CursorContext } from './cursorContext.js';
import { Position } from '../core/position.js';
import { Range } from '../core/range.js';
import { Selection } from '../core/selection.js';
import { PositionAffinity, TrackedRangeStickiness } from '../model.js';

/**
 * Represents a single cursor.
*/
/**
 * 表示单个光标。
 * 管理光标的模型状态和视图状态，以及选择跟踪。
 */
export class Cursor {

	/**
	 * 光标在模型中的状态
	 */
	public modelState!: SingleCursorState;

	/**
	 * 光标在视图中的状态
	 */
	public viewState!: SingleCursorState;

	/**
	 * 跟踪选择范围的ID
	 */
	private _selTrackedRange: string | null;

	/**
	 * 是否跟踪选择
	 */
	private _trackSelection: boolean;

	/**
	 * 构造函数
	 * @param context 光标上下文
	 */
	constructor(context: CursorContext) {
		this._selTrackedRange = null;
		this._trackSelection = true;

		// 初始化光标状态为文档开头(1,1)位置
		this._setState(
			context,
			new SingleCursorState(new Range(1, 1, 1, 1), SelectionStartKind.Simple, 0, new Position(1, 1), 0),
			new SingleCursorState(new Range(1, 1, 1, 1), SelectionStartKind.Simple, 0, new Position(1, 1), 0)
		);
	}

	/**
	 * 销毁光标，移除跟踪的范围
	 */
	public dispose(context: CursorContext): void {
		this._removeTrackedRange(context);
	}

	/**
	 * 开始跟踪选择
	 */
	public startTrackingSelection(context: CursorContext): void {
		this._trackSelection = true;
		this._updateTrackedRange(context);
	}

	/**
	 * 停止跟踪选择
	 */
	public stopTrackingSelection(context: CursorContext): void {
		this._trackSelection = false;
		this._removeTrackedRange(context);
	}

	/**
	 * 更新跟踪的范围
	 */
	private _updateTrackedRange(context: CursorContext): void {
		if (!this._trackSelection) {
			// don't track the selection
			return;
		}
		this._selTrackedRange = context.model._setTrackedRange(this._selTrackedRange, this.modelState.selection, TrackedRangeStickiness.AlwaysGrowsWhenTypingAtEdges);
	}

	/**
	 * 移除跟踪的范围
	 */
	private _removeTrackedRange(context: CursorContext): void {
		this._selTrackedRange = context.model._setTrackedRange(this._selTrackedRange, null, TrackedRangeStickiness.AlwaysGrowsWhenTypingAtEdges);
	}

	/**
	 * 将光标转换为CursorState对象
	 */
	public asCursorState(): CursorState {
		return new CursorState(this.modelState, this.viewState);
	}

	/**
	 * 从标记中读取选择
	 */
	public readSelectionFromMarkers(context: CursorContext): Selection {
		const range = context.model._getTrackedRange(this._selTrackedRange!)!;

		if (this.modelState.selection.isEmpty() && !range.isEmpty()) {
			// Avoid selecting text when recovering from markers
			return Selection.fromRange(range.collapseToEnd(), this.modelState.selection.getDirection());
		}

		return Selection.fromRange(range, this.modelState.selection.getDirection());
	}

	/**
	 * 确保光标状态有效
	 */
	public ensureValidState(context: CursorContext): void {
		this._setState(context, this.modelState, this.viewState);
	}

	/**
	 * 设置光标状态
	 */
	public setState(context: CursorContext, modelState: SingleCursorState | null, viewState: SingleCursorState | null): void {
		this._setState(context, modelState, viewState);
	}

	/**
	 * 使用缓存验证位置
	 */
	private static _validatePositionWithCache(viewModel: ICursorSimpleModel, position: Position, cacheInput: Position, cacheOutput: Position): Position {
		if (position.equals(cacheInput)) {
			return cacheOutput;
		}
		return viewModel.normalizePosition(position, PositionAffinity.None);
	}

	/**
	 * 验证视图状态
	 */
	private static _validateViewState(viewModel: ICursorSimpleModel, viewState: SingleCursorState): SingleCursorState {
		const position = viewState.position;
		const sStartPosition = viewState.selectionStart.getStartPosition();
		const sEndPosition = viewState.selectionStart.getEndPosition();

		const validPosition = viewModel.normalizePosition(position, PositionAffinity.None);
		const validSStartPosition = this._validatePositionWithCache(viewModel, sStartPosition, position, validPosition);
		const validSEndPosition = this._validatePositionWithCache(viewModel, sEndPosition, sStartPosition, validSStartPosition);

		if (position.equals(validPosition) && sStartPosition.equals(validSStartPosition) && sEndPosition.equals(validSEndPosition)) {
			// fast path: the state is valid
			return viewState;
		}

		return new SingleCursorState(
			Range.fromPositions(validSStartPosition, validSEndPosition),
			viewState.selectionStartKind,
			viewState.selectionStartLeftoverVisibleColumns + sStartPosition.column - validSStartPosition.column,
			validPosition,
			viewState.leftoverVisibleColumns + position.column - validPosition.column,
		);
	}

	/**
	 * 设置光标状态
	 */
	private _setState(context: CursorContext, modelState: SingleCursorState | null, viewState: SingleCursorState | null): void {
		if (viewState) {
			viewState = Cursor._validateViewState(context.viewModel, viewState);
		}

		if (!modelState) {
			if (!viewState) {
				return;
			}
			// We only have the view state => compute the model state
			const selectionStart = context.model.validateRange(
				context.coordinatesConverter.convertViewRangeToModelRange(viewState.selectionStart)
			);

			const position = context.model.validatePosition(
				context.coordinatesConverter.convertViewPositionToModelPosition(viewState.position)
			);

			modelState = new SingleCursorState(selectionStart, viewState.selectionStartKind, viewState.selectionStartLeftoverVisibleColumns, position, viewState.leftoverVisibleColumns);
		} else {
			// Validate new model state
			const selectionStart = context.model.validateRange(modelState.selectionStart);
			const selectionStartLeftoverVisibleColumns = modelState.selectionStart.equalsRange(selectionStart) ? modelState.selectionStartLeftoverVisibleColumns : 0;

			const position = context.model.validatePosition(
				modelState.position
			);
			const leftoverVisibleColumns = modelState.position.equals(position) ? modelState.leftoverVisibleColumns : 0;

			modelState = new SingleCursorState(selectionStart, modelState.selectionStartKind, selectionStartLeftoverVisibleColumns, position, leftoverVisibleColumns);
		}

		if (!viewState) {
			// We only have the model state => compute the view state
			const viewSelectionStart1 = context.coordinatesConverter.convertModelPositionToViewPosition(new Position(modelState.selectionStart.startLineNumber, modelState.selectionStart.startColumn));
			const viewSelectionStart2 = context.coordinatesConverter.convertModelPositionToViewPosition(new Position(modelState.selectionStart.endLineNumber, modelState.selectionStart.endColumn));
			const viewSelectionStart = new Range(viewSelectionStart1.lineNumber, viewSelectionStart1.column, viewSelectionStart2.lineNumber, viewSelectionStart2.column);
			const viewPosition = context.coordinatesConverter.convertModelPositionToViewPosition(modelState.position);
			viewState = new SingleCursorState(viewSelectionStart, modelState.selectionStartKind, modelState.selectionStartLeftoverVisibleColumns, viewPosition, modelState.leftoverVisibleColumns);
		} else {
			// Validate new view state
			const viewSelectionStart = context.coordinatesConverter.validateViewRange(viewState.selectionStart, modelState.selectionStart);
			const viewPosition = context.coordinatesConverter.validateViewPosition(viewState.position, modelState.position);
			viewState = new SingleCursorState(viewSelectionStart, modelState.selectionStartKind, modelState.selectionStartLeftoverVisibleColumns, viewPosition, modelState.leftoverVisibleColumns);
		}

		this.modelState = modelState;
		this.viewState = viewState;

		this._updateTrackedRange(context);
	}
}
