# Steam Trading Card Helper

Steam 卡牌助手是一款 Tampermonkey 用户脚本，用于扫描卡牌价格、辅助购买和管理 Steam 社区物品。

## 主要功能

- 扫描未完成的徽章，估算所需成本，并根据不同需求选择购买卡牌的方式。
- 使用手动价格或智能策略提交订购单，在总览中查看和批量撤销当前买单。
- 查看价格走势、批量合成徽章，并收藏或处理多余的卡牌、背景和表情。

## 安装

1. 安装 [Tampermonkey](https://www.tampermonkey.net/)。
2. 打开 [用户脚本安装链接](https://raw.githubusercontent.com/SpaceSyt/Steam-Trading-Card-Helper/master/steam-trading-card-helper.user.js)。
3. 进入自己的 Steam 徽章页，例如 `steamcommunity.com/id/xxx/badges/`。
4. 点击页面中的 **Steam Trading Card Helper**。

首次打开会显示使用说明，之后可以在 **设置 → 重新查看使用说明** 中再次查看。

## 使用方法

1. 在 **卡牌价格扫描** 中选择购买逻辑和价格方式，然后开始扫描。
2. 扫描完成后，可以打开 Steam 批量购买页，或选择结果提交订购单。
3. 查价失败的项目仍会保留，缺失信息显示为 `-`，之后可以重新计算。

## 智能定价

智能定价会参考市场买单深度，识别异常高价和订单墙，再按保守、平衡或抢单策略计算价格。各策略可以在高级设置中调整，订购页面内的临时调整不会覆盖默认设置。

缺少价格或明确没有买单时，可以按设置使用市场最低价；无法确认币种或订单数据时不会继续下单。

## 使用提醒

- 大量请求可能触发 Steam 限流；遇到连续 `429` 时请暂停后重试。
- 操作前请检查确认窗口；市场价格可能延迟，分解不可恢复，出售也可能需要 Steam 手机确认。

## 开发

- `npm test`：运行自动化测试。
- `npm run build`：生成用户脚本。

## 免责声明

本脚本不是 Valve 或 Steam 的官方产品。使用者应自行承担交易、物品处理、账户限制和市场波动带来的风险。

## License

[MIT](LICENSE)
