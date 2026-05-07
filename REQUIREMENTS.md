# tgtldr 功能需求清单

基于 [fr0der1c/tgtldr](https://github.com/fr0der1c/tgtldr) 的个人 fork，以下为新增和修复的功能需求。

---

## 新功能需求

### 1. 摘要频率（每群独立）
每个群组可单独设置摘要生成频率：
- `daily`：每天触发，汇总昨日消息
- `weekly`：每周一触发，汇总上周（周一到周日）消息
- `monthly`：每月 1 日触发，汇总上月消息

### 2. 关键词即时告警
每个群组可设置关键词列表（每行一个）。  
当群内新消息包含任意关键词时，立即通过已配置的 Bot 推送提醒。  
同一关键词在同一群组内 10 分钟内只提醒一次（内存冷却）。

### 3. Bot 发送自动重试
摘要生成成功但 Bot 推送失败时，自动记录失败原因和下次重试时间。  
调度器定期检查待重试队列，自动补发；支持从详情页手动触发重试。

### 4. 新群组全局默认配置
在设置页新增"群组默认配置"区块，包含以下全局默认值：
- 默认发送模式（仅网页端 / 网页端 + Bot）
- 默认摘要时间（本地时间，如 09:00）
- 默认模型覆盖（留空则使用全局模型）
- 默认是否保留 Bot 消息

新群组同步时自动应用上述默认值，已有群组配置不受影响。

### 5. 并行分块摘要
消息量较大时，按 token 预算拆成多个分块，通过 `errgroup` 并发发送给 AI 处理，最后汇总。  
减少大群摘要的等待时间。

### 6. 摘要批量补跑
手动补跑面板新增"批量"模式：
- 多选群组（支持全选）
- 选择起止日期（自动展开为逐日任务）
- 提交前显示"X 群 × Y 天 = Z 个任务"预览
- 日期选择器根据已选群组的首条消息日期限制最小可选日期
- 没有消息的日期后端自动跳过，不创建空摘要记录

### 7. 群组消息柱状图
展开群组编辑面板时，加载并显示近 30 天每日消息量的 SVG 柱状图。  
便于判断该群的消息活跃度和历史回补的价值区间。

### 8. 群组首次消息时间
群组列表每行显示该群在数据库中最早一条消息的日期（`📥 YYYY-MM-DD`）。  
帮助判断历史数据的起点。

### 9. 发送模式快速切换
群组列表新增"发送"列，显示当前发送模式（仅网页 / Bot）。  
点击 pill 直接切换，无需进入编辑面板。

### 10. 频道支持
消息监听和历史回补均支持 Telegram 频道（channel 类型），与超级群（supergroup）行为一致。

### 11. 摘要列表群组快速筛选
摘要列表顶部新增横向可滚动的群组 pill 栏，点击即过滤当前页摘要，与下方下拉框联动。

---

## Bug 修复

| # | 问题 | 修复方式 |
|---|------|---------|
| 1 | 关键词/过滤词输入框按 Enter 无法换行 | 输入框本地管理状态，失焦（onBlur）时才同步到父组件 |
| 2 | 频道历史消息回补失败：unsupported chat type channel | `inputPeerForChat` 加 `"channel"` 分支，与 supergroup 同用 `InputPeerChannel` |
| 3 | 批量补跑 0 消息日期产生空的"成功"摘要 | 后端检测到 0 消息时删除 pending/running 记录，不保存、不推送 |
| 4 | 批量补跑可选择无消息的历史日期 | 日期选择器根据已选群组首条消息时间设置 `min` 属性，越界时显示警告 |

---

## 数据库迁移（`010_enhancements.sql`）

全部使用 `ADD COLUMN IF NOT EXISTS`，对现有数据零破坏：

```sql
-- chats 表
alert_enabled         boolean  default false
alert_keywords        text[]   default '{}'
summary_frequency     text     default 'daily'

-- summaries 表
delivery_retry_count      integer    default 0
next_delivery_retry_at    timestamptz

-- app_settings 表
default_delivery_mode       text     default 'dashboard'
default_summary_time_local  text     default '09:00'
default_model_override      text     default ''
default_keep_bot_messages   boolean  default true
```

---

## 架构说明

- **后端**：Go + `gotd/td`（MTProto 用户级客户端，非 Bot API）
- **前端**：Next.js 16 + React 19（App Router）
- **数据库**：PostgreSQL，迁移由 Go 程序启动时自动执行
- **部署**：Docker Compose，ARM64（Oracle ARM）

消息拉取范围：普通群 ✅ / 超级群 ✅ / 频道 ✅ / 私聊 ❌（设计上不支持）
