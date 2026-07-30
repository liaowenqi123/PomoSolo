//! AI 规划助手 commands
//!
//! 对接前端 src/api/ai.ts，提供番茄钟计划生成能力。
//! 当前为 stub 实现：不实际调用 DeepSeek API，而是返回一个基于输入的简单默认计划，
//! 保证前端调用不报错。后续可在此处接入真实的 AI 推理逻辑。

use serde::{Deserialize, Serialize};

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
/// 当前为 stub 实现：根据输入文本生成一个简单的默认计划（25 分钟工作 + 5 分钟休息循环）。
/// 前端调用不会报错，并能在 UI 上看到合理的计划内容。
#[tauri::command]
pub async fn ai_generate_plan(input: String) -> Result<AiGenerateResult, String> {
    // stub：基于输入长度估算工作时长（最少 25 分钟，每 10 个字符加 5 分钟，上限 120 分钟）
    let work_minutes: u32 = ((25 + (input.len() as u32 / 10) * 5).min(120)).max(25);
    let break_minutes: u32 = 5;

    let plan = vec![
        AiPlanItem {
            item_type: "work".to_string(),
            minutes: work_minutes,
            description: Some(format!("专注：{}", if input.trim().is_empty() { "未命名任务".to_string() } else { input.clone() })),
        },
        AiPlanItem {
            item_type: "break".to_string(),
            minutes: break_minutes,
            description: Some("短暂休息".to_string()),
        },
        AiPlanItem {
            item_type: "work".to_string(),
            minutes: work_minutes,
            description: Some("继续专注".to_string()),
        },
        AiPlanItem {
            item_type: "break".to_string(),
            minutes: break_minutes * 2,
            description: Some("长休息".to_string()),
        },
    ];

    Ok(AiGenerateResult {
        success: true,
        data: Some(AiPlanData {
            summary: Some(format!("已为「{}」生成 4 段番茄钟计划", if input.trim().is_empty() { "未命名任务".to_string() } else { input })),
            plan,
        }),
        error: None,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn test_ai_generate_plan_returns_success() {
        let result = ai_generate_plan("写报告".to_string()).await.expect("调用应成功");
        assert!(result.success, "success 应为 true");
        let data = result.data.expect("data 应存在");
        assert!(!data.plan.is_empty(), "plan 不应为空");
        assert_eq!(data.plan[0].item_type, "work");
    }

    #[tokio::test]
    async fn test_ai_generate_plan_handles_empty_input() {
        let result = ai_generate_plan("".to_string()).await.expect("空输入也应成功");
        assert!(result.success);
        assert!(result.data.is_some());
    }

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
}
