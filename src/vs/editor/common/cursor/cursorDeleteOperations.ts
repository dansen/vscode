/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as strings from '../../../base/common/strings.js';
import { ReplaceCommand } from '../commands/replaceCommand.js';
import { EditorAutoClosingEditStrategy, EditorAutoClosingStrategy } from '../config/editorOptions.js';
import { CursorConfiguration, EditOperationResult, EditOperationType, ICursorSimpleModel, isQuote } from '../cursorCommon.js';
import { CursorColumns } from '../core/cursorColumns.js';
import { MoveOperations } from './cursorMoveOperations.js';
import { Range } from '../core/range.js';
import { Selection } from '../core/selection.js';
import { ICommand } from '../editorCommon.js';
import { StandardAutoClosingPairConditional } from '../languages/languageConfiguration.js';
import { Position } from '../core/position.js';

export class DeleteOperations {
	/**
	 * DeleteOperations 类
	 *
	 * 这个类包含了与删除操作相关的静态方法,用于处理编辑器中的各种删除场景。
	 * 主要功能包括:
	 * 1. 向右删除
	 * 2. 自动闭合对的删除
	 * 3. 向左删除
	 * 4. 剪切操作
	 */

	/**
	 * 执行向右删除操作
	 * @param prevEditOperationType 上一次编辑操作的类型
	 * @param config 光标配置
	 * @param model 简单光标模型
	 * @param selections 当前选择的范围数组
	 * @returns [是否应该在操作前推入堆栈元素, 删除命令数组]
	 */
	public static deleteRight(prevEditOperationType: EditOperationType, config: CursorConfiguration, model: ICursorSimpleModel, selections: Selection[]): [boolean, Array<ICommand | null>] {
		// 存储删除命令的数组
		const commands: Array<ICommand | null> = [];
		// 判断是否应该在操作前推入堆栈元素
		let shouldPushStackElementBefore = (prevEditOperationType !== EditOperationType.DeletingRight);

		// 遍历所有选择范围
		for (let i = 0, len = selections.length; i < len; i++) {
			const selection = selections[i];

			let deleteSelection: Range = selection;

			// 如果选择范围为空(即光标位置)
			if (deleteSelection.isEmpty()) {
				const position = selection.getPosition();
				// 获取当前位置右侧的位置
				const rightOfPosition = MoveOperations.right(config, model, position);
				// 创建一个新的范围,从当前位置到右侧位置
				deleteSelection = new Range(
					rightOfPosition.lineNumber,
					rightOfPosition.column,
					position.lineNumber,
					position.column
				);
			}

			// 如果删除范围为空(可能是文件末尾)
			if (deleteSelection.isEmpty()) {
				// 忽略此选择,不执行删除操作
				commands[i] = null;
				continue;
			}

			// 如果删除范围跨越多行,设置标志以在操作前推入堆栈元素
			if (deleteSelection.startLineNumber !== deleteSelection.endLineNumber) {
				shouldPushStackElementBefore = true;
			}

			// 创建一个替换命令,用空字符串替换删除范围
			commands[i] = new ReplaceCommand(deleteSelection, '');
		}

		// 返回是否应该推入堆栈元素和删除命令数组
		return [shouldPushStackElementBefore, commands];
	}

	public static isAutoClosingPairDelete(
		autoClosingDelete: EditorAutoClosingEditStrategy,
		autoClosingBrackets: EditorAutoClosingStrategy,
		autoClosingQuotes: EditorAutoClosingStrategy,
		autoClosingPairsOpen: Map<string, StandardAutoClosingPairConditional[]>,
		model: ICursorSimpleModel,
		selections: Selection[],
		autoClosedCharacters: Range[]
	): boolean {
		if (autoClosingBrackets === 'never' && autoClosingQuotes === 'never') {
			return false;
		}
		if (autoClosingDelete === 'never') {
			return false;
		}

		for (let i = 0, len = selections.length; i < len; i++) {
			const selection = selections[i];
			const position = selection.getPosition();

			if (!selection.isEmpty()) {
				return false;
			}

			const lineText = model.getLineContent(position.lineNumber);
			if (position.column < 2 || position.column >= lineText.length + 1) {
				return false;
			}
			const character = lineText.charAt(position.column - 2);

			const autoClosingPairCandidates = autoClosingPairsOpen.get(character);
			if (!autoClosingPairCandidates) {
				return false;
			}

			if (isQuote(character)) {
				if (autoClosingQuotes === 'never') {
					return false;
				}
			} else {
				if (autoClosingBrackets === 'never') {
					return false;
				}
			}

			const afterCharacter = lineText.charAt(position.column - 1);

			let foundAutoClosingPair = false;
			for (const autoClosingPairCandidate of autoClosingPairCandidates) {
				if (autoClosingPairCandidate.open === character && autoClosingPairCandidate.close === afterCharacter) {
					foundAutoClosingPair = true;
				}
			}
			if (!foundAutoClosingPair) {
				return false;
			}

			// Must delete the pair only if it was automatically inserted by the editor
			if (autoClosingDelete === 'auto') {
				let found = false;
				for (let j = 0, lenJ = autoClosedCharacters.length; j < lenJ; j++) {
					const autoClosedCharacter = autoClosedCharacters[j];
					if (position.lineNumber === autoClosedCharacter.startLineNumber && position.column === autoClosedCharacter.startColumn) {
						found = true;
						break;
					}
				}
				if (!found) {
					return false;
				}
			}
		}

		return true;
	}

	private static _runAutoClosingPairDelete(config: CursorConfiguration, model: ICursorSimpleModel, selections: Selection[]): [boolean, ICommand[]] {
		const commands: ICommand[] = [];
		for (let i = 0, len = selections.length; i < len; i++) {
			const position = selections[i].getPosition();
			const deleteSelection = new Range(
				position.lineNumber,
				position.column - 1,
				position.lineNumber,
				position.column + 1
			);
			commands[i] = new ReplaceCommand(deleteSelection, '');
		}
		return [true, commands];
	}

	public static deleteLeft(prevEditOperationType: EditOperationType, config: CursorConfiguration, model: ICursorSimpleModel, selections: Selection[], autoClosedCharacters: Range[]): [boolean, Array<ICommand | null>] {
		if (this.isAutoClosingPairDelete(config.autoClosingDelete, config.autoClosingBrackets, config.autoClosingQuotes, config.autoClosingPairs.autoClosingPairsOpenByEnd, model, selections, autoClosedCharacters)) {
			return this._runAutoClosingPairDelete(config, model, selections);
		}

		const commands: Array<ICommand | null> = [];
		let shouldPushStackElementBefore = (prevEditOperationType !== EditOperationType.DeletingLeft);
		for (let i = 0, len = selections.length; i < len; i++) {
			const deleteRange = DeleteOperations.getDeleteRange(selections[i], model, config);

			// Ignore empty delete ranges, as they have no effect
			// They happen if the cursor is at the beginning of the file.
			if (deleteRange.isEmpty()) {
				commands[i] = null;
				continue;
			}

			if (deleteRange.startLineNumber !== deleteRange.endLineNumber) {
				shouldPushStackElementBefore = true;
			}

			commands[i] = new ReplaceCommand(deleteRange, '');
		}
		return [shouldPushStackElementBefore, commands];

	}

	private static getDeleteRange(selection: Selection, model: ICursorSimpleModel, config: CursorConfiguration,): Range {
		if (!selection.isEmpty()) {
			return selection;
		}

		const position = selection.getPosition();

		// Unintend when using tab stops and cursor is within indentation
		if (config.useTabStops && position.column > 1) {
			const lineContent = model.getLineContent(position.lineNumber);

			const firstNonWhitespaceIndex = strings.firstNonWhitespaceIndex(lineContent);
			const lastIndentationColumn = (
				firstNonWhitespaceIndex === -1
					? /* entire string is whitespace */ lineContent.length + 1
					: firstNonWhitespaceIndex + 1
			);

			if (position.column <= lastIndentationColumn) {
				const fromVisibleColumn = config.visibleColumnFromColumn(model, position);
				const toVisibleColumn = CursorColumns.prevIndentTabStop(fromVisibleColumn, config.indentSize);
				const toColumn = config.columnFromVisibleColumn(model, position.lineNumber, toVisibleColumn);
				return new Range(position.lineNumber, toColumn, position.lineNumber, position.column);
			}
		}

		return Range.fromPositions(DeleteOperations.getPositionAfterDeleteLeft(position, model), position);
	}

	private static getPositionAfterDeleteLeft(position: Position, model: ICursorSimpleModel): Position {
		if (position.column > 1) {
			// Convert 1-based columns to 0-based offsets and back.
			const idx = strings.getLeftDeleteOffset(position.column - 1, model.getLineContent(position.lineNumber));
			return position.with(undefined, idx + 1);
		} else if (position.lineNumber > 1) {
			const newLine = position.lineNumber - 1;
			return new Position(newLine, model.getLineMaxColumn(newLine));
		} else {
			return position;
		}
	}

	public static cut(config: CursorConfiguration, model: ICursorSimpleModel, selections: Selection[]): EditOperationResult {
		const commands: Array<ICommand | null> = [];
		let lastCutRange: Range | null = null;
		selections.sort((a, b) => Position.compare(a.getStartPosition(), b.getEndPosition()));
		for (let i = 0, len = selections.length; i < len; i++) {
			const selection = selections[i];

			if (selection.isEmpty()) {
				if (config.emptySelectionClipboard) {
					// This is a full line cut

					const position = selection.getPosition();

					let startLineNumber: number,
						startColumn: number,
						endLineNumber: number,
						endColumn: number;

					if (position.lineNumber < model.getLineCount()) {
						// Cutting a line in the middle of the model
						startLineNumber = position.lineNumber;
						startColumn = 1;
						endLineNumber = position.lineNumber + 1;
						endColumn = 1;
					} else if (position.lineNumber > 1 && lastCutRange?.endLineNumber !== position.lineNumber) {
						// Cutting the last line & there are more than 1 lines in the model & a previous cut operation does not touch the current cut operation
						startLineNumber = position.lineNumber - 1;
						startColumn = model.getLineMaxColumn(position.lineNumber - 1);
						endLineNumber = position.lineNumber;
						endColumn = model.getLineMaxColumn(position.lineNumber);
					} else {
						// Cutting the single line that the model contains
						startLineNumber = position.lineNumber;
						startColumn = 1;
						endLineNumber = position.lineNumber;
						endColumn = model.getLineMaxColumn(position.lineNumber);
					}

					const deleteSelection = new Range(
						startLineNumber,
						startColumn,
						endLineNumber,
						endColumn
					);
					lastCutRange = deleteSelection;

					if (!deleteSelection.isEmpty()) {
						commands[i] = new ReplaceCommand(deleteSelection, '');
					} else {
						commands[i] = null;
					}
				} else {
					// Cannot cut empty selection
					commands[i] = null;
				}
			} else {
				commands[i] = new ReplaceCommand(selection, '');
			}
		}
		return new EditOperationResult(EditOperationType.Other, commands, {
			shouldPushStackElementBefore: true,
			shouldPushStackElementAfter: true
		});
	}
}
