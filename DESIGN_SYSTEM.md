# 1000H French 设计系统

学习界面只有一个：`web/` 中的 React SPA（挂在 `/app/`），来自 2026-11 确认的 1000H 设计原型（`design/figma-make-v3`）。旧的多页界面（`static/study.*`、`review.*`、`listen.*` 等）已在 P5 切换时删除，此前的配色、发布记录和 `tools/*.cjs` 界面检查一并移除，需要时查 git 历史。

在线参考页：`/app/design`（SCR-DSN-01）列出变量、按钮角色、组件、无障碍规格和全部页面状态。本文件只记录规则，数值以 `web/src/styles.css` 为准。

## 产品方向

目标是学满 1000 小时、到 NCLC 7，并且一路都想继续学。每天打开就知道该做什么：Study 学新文本，Review 复习到期卡片，Practice 做写作 / 口语 / 听力 / 音频，Progress 看小时数和等级。进度与游戏化是动力，不抢学习内容的位置。

## 设计原则

1. **每个页面或弹窗最多一个 Primary 动作。** 显示答案、再试一次不和 Check / Next / Done 并列成 Primary。
2. **用结构建立层级。** 页面标题 → 区块标题 → 学习内容 → 说明与元信息；先用字号、间距和位置，再用颜色。
3. **颜色只表达意义。** 蓝色是操作、链接、选中和焦点；绿色只表示正确或完成；红色只表示错误或删除；琥珀色只表示警告或离线。状态都配文字或图标，不靠颜色单独表达。
4. **答案不提前出现。** 练习目标在 Check 或 Show answer 之前不出现在文字、可访问名称、title、URL 或通知中。
5. **只记真实时间。** 学习时长按实际播放和作答的墙钟时间计算（心跳上报），不估算、不补记。
6. **手机和键盘都是完整的使用方式。** 布局用容器查询，在 320 / 390 / 768 / 桌面宽度和 200% 缩放下都不出现横向滚动；点击目标至少 44 × 44 px。

## 设计变量

在 `web/src/styles.css` 的 `:root` 中定义：

| 角色 | 变量 |
| --- | --- |
| 背景 / 表面 | `--canvas`、`--surface` |
| 正文 / 辅助文字 | `--text`、`--text-2` |
| 操作 | `--primary`、`--primary-hover`、`--primary-weak` |
| 边界 | `--border-strong`（控件）、`--divider`（分隔） |
| 状态 | `--success*`、`--error*`、`--warning*`；`--mark-bg` 用于文中标记 |
| 间距 | `--s1`…`--s8`（4、8、12、16、24、32、48、64 px） |
| 圆角 | `--r-control` 8、`--r-panel` 12、`--r-sheet` 16 |
| 阴影 | `--shadow-pop`（浮层）、`--shadow-modal`（对话框）；普通面板不用阴影 |

字号用类名表达角色：`.t-meta` 12、`.t-support` 14、`.t-body` 16、`.t-section` 20、`.t-page` 24、`.t-figure` 32；法语正文用 `lang="fr"`，大段法语用 `.t-fr-lg`。新增样式先复用这些变量和类名，不新增模块专属配色。

公开页（`/home`、`/privacy`、`/for-institutions`）仍使用 `static/tokens.css`、`style.css`、`ui.css` 和 `landing.css`，与 SPA 相互独立。

## 组件

`web/src/components/ui.tsx` 提供共用组件，新功能先用它们：

- `Button`：只有 primary / secondary / tertiary / destructive 四种角色。禁用时仍可聚焦，并通过 `disabledReason` 说明原因；`busy` 显示进行中。
- `Banner`：success / error / warning / info 四种语气。错误要用 assertive 播报，并给出恢复操作。
- `PageHead`、`Tabs`、`Segmented`、`Disclosure`、`Dialog`、`Popover`、`Pill`、`Stat`、`Importance`、`Spinner`、`Skeleton`。
- `Shell.tsx`：导航、全局播放器和同步状态。`Recorder.tsx`：麦克风录音后调用 `/api/transcribe`。

## 无障碍

- 焦点环：3 px 主色，外加 2 px 浅色间隔，所有可交互元素都有。
- 第一个元素是跳过链接。提交后焦点移到结果摘要，页面不会自动前进。
- 关闭浮层后焦点回到触发元素；模态框锁住焦点，Escape 可以关闭。
- 加载、保存和完成用 polite 播报；错误用 assertive；计时跳动不播报。
- 遵守 `prefers-reduced-motion`，关闭非必要的动画。

## 验证

```bash
cd web
npm run typecheck
npm test          # 规则测试、API 客户端测试，以及对每个已登记页面状态的渲染和防答案泄漏冒烟测试
npm run build
```

交付前用 headless Chrome 在桌面和 390px 下走一遍相关流程，测试账号要用临时数据库，不要碰真实用户数据。
