// 统一的控件已有内容判断（方案 §9）。
// 普通快速填充只填空白控件：所有"是否已有值"的判断必须走这里，
// 禁止在各个填充函数里各写一套不一致的逻辑。
// 无法确定状态时一律视为"已有值"（宁可少填，不能覆盖）。

export type FillControl = HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement;

const PLACEHOLDER_EXACT = new Set([
  '',
  '选择', '输入', '点击', '不限',
  '年', '月', '日',
  '请选择', '请输入', '请填写', '请完善', '请点击',
  '点击选择', '点击输入', '点击上传',
  '选择省份', '选择城市', '选择地区', '选择国家',
]);

const PLACEHOLDER_PREFIX = /^请(?:选择|输入|填写|完善|点击)/;
const PLACEHOLDER_DASH = /^[-—–_.*·]+$/;

/** 判断一段控件显示文字是否只是占位符（"请选择省份"、"年"、"--"等）。 */
export function isPlaceholderDisplayText(text: string): boolean {
  const trimmed = (text || '').trim();
  if (PLACEHOLDER_EXACT.has(trimmed)) return true;
  if (PLACEHOLDER_PREFIX.test(trimmed) && trimmed.length <= 20) return true;
  if (PLACEHOLDER_DASH.test(trimmed)) return true;
  return false;
}

const CUSTOM_SELECT_CONTAINER_SELECTOR = '.ud__select, .ant-select, .el-select, .arco-select, .semi-select, [class*="select" i], [class*="picker" i]';
const CUSTOM_SELECT_VALUE_SELECTOR = [
  '.ud__select__selector__selectItem',
  '.ant-select-selection-item',
  '.ant-select-selection__rendered',
  '.el-select__selected-item',
  '.arco-select-view-value',
  '.semi-select-selection-item',
].join(', ');

function getInputType(element: FillControl): string {
  return element.tagName === 'INPUT' ? ((element as HTMLInputElement).type || '').toLowerCase() : '';
}

function isCustomSelectControl(element: FillControl): boolean {
  if (element.tagName !== 'INPUT') return false;
  if (element.getAttribute?.('role') === 'combobox') return true;
  return Boolean(element.closest?.(CUSTOM_SELECT_CONTAINER_SELECTOR));
}

/** 自定义下拉框：综合内部 input 值、选中项节点与触发器文字。 */
function readCustomSelectDisplayText(element: FillControl): string {
  const texts: string[] = [element.value || ''];
  const trigger = element.closest?.(CUSTOM_SELECT_CONTAINER_SELECTOR) as HTMLElement | null;
  if (trigger?.querySelectorAll) {
    trigger.querySelectorAll(CUSTOM_SELECT_VALUE_SELECTOR).forEach(node => {
      texts.push(node.textContent || '');
    });
  }
  if (trigger?.textContent) texts.push(trigger.textContent);
  return texts
    .filter(text => !isPlaceholderDisplayText(text))
    .join(' ')
    .trim();
}

function escapeAttribute(value: string): string {
  return value.replace(/[\\"]/g, '\\$&');
}

/** radio：同组已有任一选项选中即视为已有值。 */
function isRadioGroupBlank(input: HTMLInputElement): boolean {
  const name = input.getAttribute?.('name') || '';
  const doc = input.ownerDocument;
  if (name && doc?.querySelectorAll) {
    try {
      const radios = Array.from(
        doc.querySelectorAll<HTMLInputElement>(`input[type="radio"][name="${escapeAttribute(name)}"]`),
      );
      if (radios.length > 0) return !radios.some(radio => radio.checked);
    } catch {
      // 选择器异常时退回容器/自身判断
    }
  }

  const group = input.closest?.(
    '[role="radiogroup"], fieldset, [data-form-field-id], [data-form-field-name]',
  );
  if (group?.querySelectorAll) {
    const radios = Array.from(group.querySelectorAll<HTMLInputElement>('input[type="radio"]'));
    if (radios.length > 0) return !radios.some(radio => radio.checked);
  }

  return !input.checked;
}

/** checkbox：同组任一已勾选即视为已有值，不能只看当前这一个控件。 */
function isCheckboxGroupBlank(input: HTMLInputElement): boolean {
  const name = input.getAttribute?.('name') || '';
  const doc = input.ownerDocument;
  if (name && doc?.querySelectorAll) {
    try {
      const boxes = Array.from(
        doc.querySelectorAll<HTMLInputElement>(`input[type="checkbox"][name="${escapeAttribute(name)}"]`),
      );
      if (boxes.length > 0) return !boxes.some(box => box.checked);
    } catch {
      // 选择器异常时退回自身判断
    }
  }
  return !input.checked;
}

/** 原生 select：未选中或选中项只是"请选择"类占位项都算空白。 */
function isNativeSelectBlank(select: HTMLSelectElement): boolean {
  const option = select.options?.[select.selectedIndex];
  if (!option) return true;
  return isPlaceholderDisplayText(option.text || '') && isPlaceholderDisplayText(option.value || '');
}

/**
 * 控件当前向用户展示的内容（用于日志/报告，不用于安全判断）。
 */
export function getControlDisplayedValue(element: FillControl): string {
  try {
    if (element.tagName === 'SELECT') {
      const select = element as HTMLSelectElement;
      return select.options?.[select.selectedIndex]?.text?.trim() || '';
    }
    const inputType = getInputType(element);
    if (inputType === 'radio' || inputType === 'checkbox') {
      return (element as HTMLInputElement).checked ? ((element as HTMLInputElement).value || '已勾选') : '';
    }
    if (inputType === 'file') {
      return Array.from((element as HTMLInputElement).files || [])
        .map(file => file.name)
        .join(', ');
    }
    if (isCustomSelectControl(element)) {
      return readCustomSelectDisplayText(element);
    }
    return (element.value || '').trim();
  } catch {
    return '';
  }
}

/** radio/checkbox 的组级空白判断；其他控件类型等价于 isControlBlank。 */
export function isChoiceGroupBlank(element: FillControl): boolean {
  try {
    const inputType = getInputType(element);
    if (inputType === 'radio') return isRadioGroupBlank(element as HTMLInputElement);
    if (inputType === 'checkbox') return isCheckboxGroupBlank(element as HTMLInputElement);
    return isControlBlank(element);
  } catch {
    return false;
  }
}

/**
 * 控件是否为空白（可以安全写入）。
 * 判断失败时返回 false（视为已有值），确保不会覆盖页面内容。
 */
export function isControlBlank(element: FillControl): boolean {
  try {
    if (element.tagName === 'SELECT') return isNativeSelectBlank(element as HTMLSelectElement);

    const inputType = getInputType(element);
    if (inputType === 'radio') return isRadioGroupBlank(element as HTMLInputElement);
    if (inputType === 'checkbox') return isCheckboxGroupBlank(element as HTMLInputElement);
    if (inputType === 'file') {
      const files = (element as HTMLInputElement).files;
      return !files || files.length === 0;
    }
    if (isCustomSelectControl(element)) return readCustomSelectDisplayText(element) === '';
    return !(element.value || '').trim();
  } catch {
    return false;
  }
}
