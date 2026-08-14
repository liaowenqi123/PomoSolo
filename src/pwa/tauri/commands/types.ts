/**
 * 命令注册表类型
 * 部门：PWA部门 —— 2026-08 PWA 第一版
 */

export type CommandHandler = (args: Record<string, unknown>) => Promise<unknown>;

export type CommandRegistry = Record<string, CommandHandler>;
