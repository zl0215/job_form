export type FormControl = HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement;

/**
 * querySelectorAll 不会穿透 Shadow DOM，也不会进入 iframe。
 * 快速填充时递归收集开放 Shadow Root 中的原生表单控件。
 * iframe 由 manifest 的 all_frames 在各 frame 内分别执行，避免同一控件重复填写。
 */
export function collectFormControls(root: ParentNode = document): FormControl[] {
  const controls: FormControl[] = [];
  const visited = new Set<ParentNode>();

  const visit = (current: ParentNode) => {
    if (visited.has(current)) return;
    visited.add(current);

    controls.push(...Array.from(
      current.querySelectorAll<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>(
        'input, textarea, select',
      ),
    ));

    for (const element of Array.from(current.querySelectorAll<HTMLElement>('*'))) {
      if (element.shadowRoot) visit(element.shadowRoot);
    }
  };

  visit(root);
  return controls;
}
