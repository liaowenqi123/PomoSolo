//! AI 规划助手 commands
//!
//! 对接前端 src/api/ai.ts，提供番茄钟计划生成能力。
//! 真实调用 DeepSeek API（与旧版 Electron aiAssistant.js 对齐）：
//! - API Key 优先取 ChartsState 内存（云端登录 / save_api_key 时注入），
//!   其次读 data.json 的 apiKey（本地模式持久化），并回注内存供下载器复用。
//! - 响应解析容错：支持纯 JSON、```json 代码块、以及混在文字中的 JSON。

use serde::{Deserialize, Serialize};
use serde_json::Value;
use tauri::{AppHandle, Manager};

const DEEPSEEK_API_URL: &str = "https://api.deepseek.com/v1/chat/completions";
const DEEPSEEK_MODEL: &str = "deepseek-chat";
const REQUEST_TIMEOUT_SECS: u64 = 30;

/// 系统提示词（与旧版 electron/src/modules/aiAssistant.js 一致）
const SYSTEM_PROMPT: &str = r#"你是一个番茄钟规划助手。用户会告诉你他们的工作或学习需求，你需要帮他们规划合理的工作和休息时间。

规则：
1. 工作时间通常为25分钟（标准番茄钟），也可以是15、30、45、60分钟
2. 短休息通常为5分钟，长休息为10-15分钟
3. 每完成4个工作番茄钟后，建议安排一次长休息
4. 根据任务难度和时长合理安排

请以JSON格式返回计划，格式如下：
{
  "plan": [
    {"type": "work", "minutes": 25, "description": "任务描述"},
    {"type": "break", "minutes": 5, "description": "短休息"}
  ],
  "summary": "计划总结说明"
}

只返回JSON，不要其他文字。"#;

/// 单条计划项
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AiPlanItem {
    /// 类型：'work' | 'break'
    #[serde(rename = "type")]
    pub item_type: String,
    /// 时长（分钟）
    pub minutes: u32,
    /// 描述（可选）
    #[serde(skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
}

/// AI 生成的计划数据
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AiPlanData {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub summary: Option<String>,
    pub plan: Vec<AiPlanItem>,
}

/// AI 生成计划返回值（与前端 src/api/ai.ts 的 AiGenerateResult 对齐）
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AiGenerateResult {
    pub success: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub data: Option<AiPlanData>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

/// 生成番茄钟计划
///
/// 真实调用 DeepSeek API；无 API Key 或调用失败时返回 success=false + 中文错误信息，
/// 前端 AIHelper.vue 直接展示 error 字段。
#[tauri::command]
pub async fn ai_generate_plan(app: AppHandle, input: String) -> Result<AiGenerateResult, String> {
    let input = input.trim().to_string();
    if input.is_empty() {
        return Ok(AiGenerateResult {
            success: false,
            data: None,
            error: Some("请输入您的工作或学习需求".to_string()),
        });
    }

    let api_key = match resolve_api_key(&app).await {
        Some(k) => k,
        None => {
            return Ok(AiGenerateResult {
                success: false,
                data: None,
                error: Some("请先登录或配置 DeepSeek API Key".to_string()),
            });
        }
    };

    match call_deepseek(&api_key, &input).await {
        Ok(data) => Ok(AiGenerateResult {
            success: true,
            data: Some(data),
            error: None,
        }),
        Err(e) => Ok(AiGenerateResult {
            success: false,
            data: None,
            error: Some(e),
        }),
    }
}

/// 获取 DeepSeek API Key：先查 ChartsState 内存，再读 data.json（并回注内存）
async fn resolve_api_key(app: &AppHandle) -> Option<String> {
    // 1. ChartsState 内存（云端登录 admin 拉取 / save_api_key / charts_set_api_key 注入）
    {
        let charts_state = app.state::<crate::state::ChartsState>();
        let guard = charts_state.inner.lock().await;
        if let Some(k) = guard.api_key.as_ref() {
            if !k.is_empty() {
                return Some(k.clone());
            }
        }
    }

    // 2. data.json 的 apiKey（本地模式持久化），回注内存供下载器等复用
    if let Ok(data) = crate::modules::data_manager::read_data(app) {
        if let Some(k) = data.get("apiKey").and_then(|v| v.as_str()) {
            if !k.is_empty() {
                let key = k.to_string();
                let charts_state = app.state::<crate::state::ChartsState>();
                let mut guard = charts_state.inner.lock().await;
                guard.api_key = Some(key.clone());
                return Some(key);
            }
        }
    }

    None
}

/// 调用 DeepSeek Chat Completions API
async fn call_deepseek(api_key: &str, user_input: &str) -> Result<AiPlanData, String> {
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(REQUEST_TIMEOUT_SECS))
        .build()
        .map_err(|e| format!("构建 HTTP 客户端失败: {}", e))?;

    let body = serde_json::json!({
        "model": DEEPSEEK_MODEL,
        "messages": [
            { "role": "system", "content": SYSTEM_PROMPT },
            { "role": "user", "content": user_input }
        ],
        "temperature": 0.7,
        "max_tokens": 1000
    });

    let resp = client
        .post(DEEPSEEK_API_URL)
        .header(reqwest::header::AUTHORIZATION, format!("Bearer {}", api_key))
        .json(&body)
        .send()
        .await
        .map_err(|e| format!("请求 DeepSeek 失败: {}", e))?;

    if !resp.status().is_success() {
        let status = resp.status();
        let body_text = resp.text().await.unwrap_or_default();
        // 401 一般是 Key 无效，单独提示更友好
        if status.as_u16() == 401 {
            return Err("DeepSeek API Key 无效，请检查后重试".to_string());
        }
        return Err(format!("DeepSeek 请求失败 ({}): {}", status, body_text));
    }

    let json: Value = resp
        .json()
        .await
        .map_err(|e| format!("解析 DeepSeek 响应失败: {}", e))?;

    let content = json
        .pointer("/choices/0/message/content")
        .and_then(|v| v.as_str())
        .ok_or_else(|| "DeepSeek 响应缺少内容".to_string())?;

    parse_ai_response(content)
}

/// 解析 AI 返回的 JSON 响应（对齐旧版 parseAIResponse 的容错策略）
///
/// 依次尝试：直接解析 → ```json/``` 代码块提取 → 首个 '{' 到末个 '}' 的子串。
pub(crate) fn parse_ai_response(content: &str) -> Result<AiPlanData, String> {
    let trimmed = content.trim();

    // 1. 直接解析
    if let Ok(v) = serde_json::from_str::<Value>(trimmed) {
        return plan_data_from_value(v);
    }

    // 2. markdown 代码块（```json ... ``` 或 ``` ... ```）
    if let Some(block) = extract_code_block(trimmed) {
        if let Ok(v) = serde_json::from_str::<Value>(&block) {
            return plan_data_from_value(v);
        }
    }

    // 3. 提取首个 '{' 到末个 '}' 之间的子串
    if let (Some(start), Some(end)) = (trimmed.find('{'), trimmed.rfind('}')) {
        if start < end {
            if let Ok(v) = serde_json::from_str::<Value>(&trimmed[start..=end]) {
                return plan_data_from_value(v);
            }
        }
    }

    Err("AI响应格式错误".to_string())
}

/// 提取 markdown 代码块内容（优先 ```json，其次普通 ```）
fn extract_code_block(content: &str) -> Option<String> {
    for marker in ["```json", "```"] {
        if let Some(start) = content.find(marker) {
            let rest = &content[start + marker.len()..];
            if let Some(end) = rest.find("```") {
                let block = rest[..end].trim();
                if !block.is_empty() {
                    return Some(block.to_string());
                }
            }
        }
    }
    None
}

/// 把 AI 返回的 JSON 值校验并转换为 AiPlanData
///
/// 容错规则：无效计划项（type 非 work/break、minutes 非正数）跳过；
/// 全部无效或 plan 缺失/为空时报错。minutes 兼容字符串数字。
fn plan_data_from_value(v: Value) -> Result<AiPlanData, String> {
    let plan_arr = v
        .get("plan")
        .and_then(|p| p.as_array())
        .ok_or_else(|| "AI响应格式错误：缺少 plan 数组".to_string())?;

    let mut plan: Vec<AiPlanItem> = Vec::new();
    for item in plan_arr {
        let item_type = item
            .get("type")
            .and_then(|t| t.as_str())
            .unwrap_or("")
            .to_lowercase();
        let item_type = match item_type.as_str() {
            "work" | "break" => item_type,
            _ => continue, // 跳过未知类型
        };

        // minutes 兼容数字与字符串数字
        let minutes = item
            .get("minutes")
            .and_then(|m| {
                m.as_u64()
                    .or_else(|| m.as_str().and_then(|s| s.trim().parse::<u64>().ok()))
            })
            .unwrap_or(0);
        if minutes == 0 {
            continue;
        }
        // 钳制到合理范围：1-480 分钟
        let minutes = (minutes as u32).clamp(1, 480);

        let description = item
            .get("description")
            .and_then(|d| d.as_str())
            .map(|s| s.to_string());

        plan.push(AiPlanItem {
            item_type,
            minutes,
            description,
        });
    }

    if plan.is_empty() {
        return Err("AI响应格式错误：plan 为空或无有效项".to_string());
    }

    let summary = v
        .get("summary")
        .and_then(|s| s.as_str())
        .map(|s| s.to_string());

    Ok(AiPlanData { summary, plan })
}

#[cfg(test)]
mod tests {
    use super::*;

    // ===== parse_ai_response =====

    #[test]
    fn test_parse_plain_json() {
        let content = r#"{"plan":[{"type":"work","minutes":25,"description":"写报告"},{"type":"break","minutes":5}],"summary":"计划总结"}"#;
        let data = parse_ai_response(content).expect("纯 JSON 应解析成功");
        assert_eq!(data.plan.len(), 2);
        assert_eq!(data.plan[0].item_type, "work");
        assert_eq!(data.plan[0].minutes, 25);
        assert_eq!(data.plan[0].description.as_deref(), Some("写报告"));
        assert_eq!(data.plan[1].item_type, "break");
        assert_eq!(data.summary.as_deref(), Some("计划总结"));
    }

    #[test]
    fn test_parse_json_code_block() {
        let content = "这是计划：\n```json\n{\"plan\":[{\"type\":\"work\",\"minutes\":30}]}\n```\n希望有帮助！";
        let data = parse_ai_response(content).expect("```json 代码块应解析成功");
        assert_eq!(data.plan.len(), 1);
        assert_eq!(data.plan[0].minutes, 30);
    }

    #[test]
    fn test_parse_plain_code_block() {
        let content = "```\n{\"plan\":[{\"type\":\"break\",\"minutes\":10}]}\n```";
        let data = parse_ai_response(content).expect("普通 ``` 代码块应解析成功");
        assert_eq!(data.plan[0].item_type, "break");
    }

    #[test]
    fn test_parse_json_embedded_in_text() {
        let content = "好的，为您规划如下 {\"plan\":[{\"type\":\"work\",\"minutes\":45,\"description\":\"复习\"}],\"summary\":\"复习计划\"} 祝顺利";
        let data = parse_ai_response(content).expect("混在文字中的 JSON 应解析成功");
        assert_eq!(data.plan[0].minutes, 45);
        assert_eq!(data.summary.as_deref(), Some("复习计划"));
    }

    #[test]
    fn test_parse_invalid_content_returns_error() {
        assert!(parse_ai_response("完全不是 JSON").is_err());
        assert!(parse_ai_response("").is_err());
    }

    #[test]
    fn test_parse_missing_plan_returns_error() {
        let content = r#"{"summary":"没有计划"}"#;
        assert!(parse_ai_response(content).is_err());
    }

    #[test]
    fn test_parse_empty_plan_returns_error() {
        let content = r#"{"plan":[]}"#;
        assert!(parse_ai_response(content).is_err());
    }

    // ===== plan_data_from_value 容错 =====

    #[test]
    fn test_invalid_items_are_skipped() {
        let content = r#"{"plan":[
            {"type":"invalid","minutes":25},
            {"type":"work","minutes":0},
            {"type":"work","minutes":25,"description":"有效项"}
        ]}"#;
        let data = parse_ai_response(content).expect("应跳过无效项保留有效项");
        assert_eq!(data.plan.len(), 1);
        assert_eq!(data.plan[0].minutes, 25);
    }

    #[test]
    fn test_all_invalid_items_returns_error() {
        let content = r#"{"plan":[{"type":"unknown","minutes":25}]}"#;
        assert!(parse_ai_response(content).is_err());
    }

    #[test]
    fn test_minutes_accepts_string_number() {
        let content = r#"{"plan":[{"type":"work","minutes":"25"}]}"#;
        let data = parse_ai_response(content).expect("字符串数字应被兼容");
        assert_eq!(data.plan[0].minutes, 25);
    }

    #[test]
    fn test_minutes_clamped_to_max() {
        let content = r#"{"plan":[{"type":"work","minutes":99999}]}"#;
        let data = parse_ai_response(content).expect("超大 minutes 应被钳制");
        assert_eq!(data.plan[0].minutes, 480);
    }

    #[test]
    fn test_type_case_insensitive() {
        let content = r#"{"plan":[{"type":"Work","minutes":25},{"type":"BREAK","minutes":5}]}"#;
        let data = parse_ai_response(content).expect("type 大小写应被兼容");
        assert_eq!(data.plan[0].item_type, "work");
        assert_eq!(data.plan[1].item_type, "break");
    }

    // ===== extract_code_block =====

    #[test]
    fn test_extract_code_block_prefers_json_marker() {
        let content = "```\nnot json\n```\n```json\n{\"a\":1}\n```";
        let block = extract_code_block(content).expect("应提取到代码块");
        // ```json 标记优先，但因为 ``` 也是候选，取决于实现顺序：
        // 本实现先找 ```json，应得到 {"a":1}
        assert_eq!(block, "{\"a\":1}");
    }

    #[test]
    fn test_extract_code_block_none_when_absent() {
        assert!(extract_code_block("没有代码块").is_none());
    }

    // ===== 序列化（保留原有测试） =====

    #[test]
    fn test_ai_plan_item_camel_case_serialization() {
        let item = AiPlanItem {
            item_type: "work".to_string(),
            minutes: 25,
            description: Some("test".to_string()),
        };
        let json = serde_json::to_string(&item).expect("序列化应成功");
        // type 字段保持原名
        assert!(json.contains("\"type\""));
        assert!(json.contains("\"minutes\""));
        assert!(json.contains("\"description\""));
    }

    #[test]
    fn test_ai_generate_result_camel_case_serialization() {
        let result = AiGenerateResult {
            success: true,
            data: None,
            error: None,
        };
        let json = serde_json::to_string(&result).expect("序列化应成功");
        assert!(json.contains("\"success\""));
        // None 字段应被跳过
        assert!(!json.contains("data"));
        assert!(!json.contains("error"));
    }

    #[test]
    fn test_system_prompt_contains_key_rules() {
        // 提示词应包含旧版核心规则，防止被意外改坏
        assert!(SYSTEM_PROMPT.contains("番茄钟规划助手"));
        assert!(SYSTEM_PROMPT.contains("25分钟"));
        assert!(SYSTEM_PROMPT.contains("只返回JSON"));
    }
}
