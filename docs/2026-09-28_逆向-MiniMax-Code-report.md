# MiniMax Code 原生 API 接入依据

分析日期：2026-09-28。范围见 [scope.md](../tools/minimaxcode/scope.md)。本文记录兼容性分析，非漏洞报告。

EchoBird 提供 MiniMax CLI 和 MiniMax Desktop／桌面端两个入口。国内、国际桌面版共用一个入口及图标，名称随界面语言翻译。Mother Agent 安装前确认地区；已明确指定时直接使用对应官方下载渠道。EchoBird 仅提供 API 模型切换，账号登录交由原生客户端处理。

## Evidence

| ID | 来源 | 观察 |
|---|---|---|
| E-001 | 官方 [CLI 源码](https://github.com/MiniMax-AI/minimax-code/tree/c593d3d52c2544faeed1753a486434739b741bd3)，0.5.8 | packages/config/src/local-model-provider-write.ts 定义原生 custom_provider 与默认模型写入方式；提交固定内容 |
| E-002 | 本机国内／国际 3.0.73 安装包的 resources/app.asar 和 app-update.yml | 国内包 NEXT_PUBLIC_LOCALE=zh，应用身份 com.minimax.agent.cn；国际包 locale=en，身份 com.minimax.agent。国内安装在 E 盘，国际安装在用户 Programs 目录 |
| E-003 | [国内下载页](https://agent.minimax.cn/download)、[国际下载页](https://agent.minimax.io/download) 及原生 modules/updater/config.js | 国内更新域名 filecdn.minimax.chat，国际 file.cdn.minimax.io。两者均可能使用 minimax-agent 或 minimax-agent-prod 路径，不能只按路径判断地区 |

本机安装包与动态网页未归档（content_hash=n/a）。未将本机凭据写入仓库，未采用竞争对手 GPL 实现。

## Findings

| ID | 证据 | 结论 |
|---|---|---|
| F-001 | E-002、E-003 | 两种桌面版可在不同路径共存，原生应用身份和用户目录区分地区。默认安装路径可能重叠，安装时须检查现有程序。合并入口沿用自定义扫描路径优先顺序选择启动目标 |
| F-002 | E-001、E-002 | CLI 和两种桌面版默认共用 ~/.minimax/config.yaml。API 模型选择会同时影响读取该配置的客户端 |
| F-003 | E-001 | 写入原生 custom_provider.echobird、defaultModel 与 defaultLightModel；保留其他提供商和用户设置，配置文件采用原生兼容目录锁和原子替换 |

以上均为兼容性结论，severity=n/a_re，confidence=high，status=validated。

## Path

P-001，path_type=callflow：

1. 用户选择 CLI 或桌面端；桌面安装先确认国内／国际，核对官网及本机安装路径。E-002、E-003 → F-001。
2. 应用 API 模型时读取原生配置，在文件锁保护下更新 EchoBird 提供商和默认模型。E-001 → F-002、F-003。
3. 应用并启动沿用现有流程，按选定可执行文件路径重启桌面客户端，避免关闭另一目录里的同名程序。E-002 → F-001。

## 验证与限制

前端检查：typecheck、format:check、lint、Vitest。Rust 检查依次为 fmt、clippy --all-targets --all-features -- -D warnings、cargo test。

定向测试覆盖两区新旧更新 URL、Windows/macOS 资源路径、双安装路径优先级、CLI 与桌面安装目标隔离、模型协议和配置保留。实机只读测试使用本机两个安装路径验证检测，不写真实模型配置，不执行收费调用。macOS/Linux 尚未上机验证。

## Timeline

- 2026-09-28：核对官方 CLI 与已安装国际桌面包。
- 2026-09-28：核对新增国内安装，复现并修正仅按更新路径识别地区的错误。
- 2026-09-28：按用户最终决定合并桌面入口，移除 EchoBird 内 MiniMax 账号登录、切换和账号额度功能。

协议参考源码的 MIT 声明随 [minimax-code-LICENSE.txt](../tools/minimaxcode/minimax-code-LICENSE.txt) 保留。
