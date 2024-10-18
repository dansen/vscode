/*---------------------------------------------------------------------------------------------
 *  版权所有 (c) Microsoft Corporation。保留所有权利。
 *  根据 MIT 许可证授权。有关许可信息,请参阅项目根目录中的 License.txt。
 *--------------------------------------------------------------------------------------------*/

// 导入必要的接口和类型
import { ITextModel } from '../model.js';
import { ICoordinatesConverter } from '../viewModel.js';
import { CursorConfiguration, ICursorSimpleModel } from '../cursorCommon.js';

// 定义 CursorContext 类,用于管理光标上下文
export class CursorContext {
	// 品牌属性,用于类型识别,设置为 undefined
	_cursorContextBrand: void = undefined;

	// 只读属性,存储文本模型
	public readonly model: ITextModel;
	// 只读属性,存储视图模型
	public readonly viewModel: ICursorSimpleModel;
	// 只读属性,存储坐标转换器
	public readonly coordinatesConverter: ICoordinatesConverter;
	// 只读属性,存储光标配置
	public readonly cursorConfig: CursorConfiguration;

	// 构造函数,初始化 CursorContext 实例
	constructor(
		model: ITextModel,
		viewModel: ICursorSimpleModel,
		coordinatesConverter: ICoordinatesConverter,
		cursorConfig: CursorConfiguration
	) {
		// 初始化各个属性
		this.model = model;
		this.viewModel = viewModel;
		this.coordinatesConverter = coordinatesConverter;
		this.cursorConfig = cursorConfig;
	}
}
