// cli/prompts.ts —— enquirer 交互式 prompt
// P1-1 产出：交互式技术栈选择，支持 recommended 默认 + experimental 标注。

import Enquirer from 'enquirer';
import { STACK_OPTIONS, type StackKey, type StackSelection } from './options.js';

interface SelectChoice {
  name: string;
  message: string;
  value: string;
  disabled?: boolean;
  hint?: string;
}

/**
 * 交互式收集技术栈选择。
 * 用户按 Ctrl+C 退出时抛出异常（调用方处理）。
 */
export async function promptStack(initial?: Partial<StackSelection>): Promise<StackSelection> {
  const result: Partial<StackSelection> = { ...initial };

  for (const key of Object.keys(STACK_OPTIONS) as StackKey[]) {
    const choices = STACK_OPTIONS[key];
    const initialIdx = Math.max(
      0,
      (choices as ReadonlyArray<{ value: string; recommended?: boolean }>).findIndex(
        (c) => c.value === (result[key] ?? (c.recommended ? c.value : '')),
      ),
    );

    const promptName = `${key}Prompt`;
    type PromptAnswer = { [k: string]: string };
    const answer = (await Enquirer.prompt<PromptAnswer>({
      name: promptName,
      type: 'select',
      message: selectMessage(key),
      choices: (choices as ReadonlyArray<{ value: string; label: string; recommended?: boolean; experimental?: boolean }>)
        .map<SelectChoice>((c) => ({
          name: c.value,
          message: c.label,
          value: c.value,
          hint: c.recommended ? '推荐' : c.experimental ? 'experimental' : undefined,
        })),
      result(value: string) {
        // select 类型 result 返回选中项的 name
        return value;
      },
      initial: initialIdx,
    })) as PromptAnswer;

    result[key] = answer[promptName];
  }

  return result as StackSelection;
}

/**
 * 交互式确认生成。
 */
export async function promptConfirm(projectName: string, stack: StackSelection): Promise<boolean> {
  type ConfirmAnswer = { confirm: boolean };
  const answer = (await Enquirer.prompt<ConfirmAnswer>({
    name: 'confirm',
    type: 'confirm',
    message: `将在 ${projectName}/ 生成项目（${stack.backend} + ${stack.db} + ${stack.frontend}），继续？`,
    initial: true,
  })) as ConfirmAnswer;
  return answer.confirm;
}

function selectMessage(key: StackKey): string {
  const messages: Record<StackKey, string> = {
    backend: '选择后端技术栈',
    db: '选择数据库',
    frontend: '选择前端技术栈',
    contract: '选择契约库',
    auth: '选择认证方案',
    ci: '选择 CI 平台',
  };
  return messages[key];
}
