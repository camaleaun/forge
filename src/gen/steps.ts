import type { Ir, Node } from '../ir/types.ts';

// What the native generators need to know about <steps> and the navigation effects of an app.
export type Navigation = { next: boolean; back: boolean; step: boolean; quit: boolean };

export function stepIds(ir: Ir): string[] {
  const ids: string[] = [];
  const visit = (node: Node): void => {
    if (node.kind === 'step') ids.push(node.id);
    node.children.forEach(visit);
  };
  visit(ir.root);
  return ids;
}

// Only the navigation the handlers use is declared, so an app without it carries no extra code.
export function navigationUsed(ir: Ir): Navigation {
  const used: Navigation = { next: false, back: false, step: false, quit: false };
  for (const effect of ir.handlers.flatMap((handler) => handler.effects)) {
    if (effect.op === 'quit') used.quit = true;
    else if (effect.op === 'go') {
      if (effect.to === 'next') used.next = true;
      else if (effect.to === 'back') used.back = true;
      else used.step = true;
    }
  }
  return used;
}

function hasButton(ir: Ir, flag: 'primary' | 'cancel'): boolean {
  const visit = (node: Node): boolean => node[flag] === true || node.children.some(visit);
  return visit(ir.root);
}

// The members a Surface class gets when the app has <steps>, a quit effect or a cancel button: the pages (one view
// per step, with the window size of the screen and its primary and cancel buttons), the navigation the handlers use,
// and on every switch the window resize and the keys (Enter and Escape belong to the buttons of the visible screen).
export function stepMembers(ir: Ir, flavor: 'macos' | 'linux'): string {
  const used = navigationUsed(ir);
  const hasSteps = stepIds(ir).length > 0;
  const mac = flavor === 'macos';
  const hasCancel = hasButton(ir, 'cancel');
  const view = mac ? 'NSView*' : 'GtkWidget*';
  const button = mac ? 'NSButton*' : 'GtkWidget*';
  const window = mac ? 'NSWindow*' : 'GtkWidget*';
  const quit = mac ? '[NSApp terminate:nil];' : 'g_application_quit(g_application_get_default());';
  const hide = mac ? '[steps_[i].view setHidden:i != index];' : 'gtk_widget_set_visible(steps_[i].view, i == index);';
  const keys = mac
    ? `[steps_[i].primary setKeyEquivalent:i == index ? @"\\r" : @""];
      [steps_[i].cancel setKeyEquivalent:i == index ? @"\\033" : @""];`
    : '';
  const resize = mac
    ? '[window_ setContentSize:NSMakeSize(steps_[index].width, steps_[index].height)];'
    : `gtk_window_set_default_size(GTK_WINDOW(window_), steps_[index].width, steps_[index].height);
    gtk_widget_set_size_request(gtk_window_get_child(GTK_WINDOW(window_)), steps_[index].width, steps_[index].height);
    gtk_window_set_default_widget(GTK_WINDOW(window_), steps_[index].primary);
    cancel_ = steps_[index].cancel;`;
  const members: string[] = [];
  if (hasSteps) {
    members.push(`  // <steps>: one page per screen; showing one hides the others and sizes the window to it.
  void add_step(${view} page, int width, int height, ${button} primary, ${button} cancel) { steps_.push_back({page, width, height, primary, cancel}); }
  void start_steps(${window} window) {
    window_ = window;
    show(0);
  }`);
  }
  if (!mac && hasCancel) {
    members.push(`  // Escape: presses the cancel button of the visible screen (if it can be pressed).
  void set_cancel(GtkWidget* button) { cancel_ = button; }
  bool press_cancel() {
    if (!cancel_ || !gtk_widget_is_sensitive(cancel_)) return false;
    gtk_widget_activate(cancel_);
    return true;
  }`);
  }
  if (used.next) members.push('  void go_next() override { show(current_ + 1 < steps_.size() ? current_ + 1 : current_); }');
  if (used.back) members.push('  void go_back() override { show(current_ > 0 ? current_ - 1 : 0); }');
  if (used.step) members.push('  void go_step(StepId id) override { show(static_cast<std::size_t>(id)); }');
  if (used.quit) members.push(`  void quit() override { ${quit} }`);
  if (members.length === 0) return '';
  const fields: string[] = [];
  if (hasSteps) {
    fields.push(`  struct Step {
    ${view} view;
    int width;
    int height;
    ${button} primary;
    ${button} cancel;
  };
  void show(std::size_t index) {
    if (index >= steps_.size()) return;
    current_ = index;
    for (std::size_t i = 0; i < steps_.size(); ++i) {
      ${hide}${keys ? `\n      ${keys}` : ''}
    }
    ${resize}
  }
  std::vector<Step> steps_;
  std::size_t current_ = 0;
  ${window} window_ = nullptr;`);
  }
  if (!mac && hasCancel) fields.push('  GtkWidget* cancel_ = nullptr;');
  return `\n${members.join('\n')}\n${fields.length > 0 ? ` private:\n${fields.join('\n')}\n` : ''}`;
}

function hasWaitingButton(ir: Ir): boolean {
  const visit = (node: Node): boolean => node.disabledDuringDownload === true || node.children.some(visit);
  return visit(ir.root);
}

// A button with waitsForDownload follows the same signal as the download bar: the surface refreshes it with the texts.
function withWaitingButtons(source: string, flavor: 'macos' | 'linux'): string {
  const mac = flavor === 'macos';
  const button = mac ? 'NSButton*' : 'GtkWidget*';
  const state = mac ? '[button setEnabled:!downloading]' : 'gtk_widget_set_sensitive(button, !downloading)';
  const bars = mac ? 'std::vector<NSProgressIndicator*> bars_;\n' : 'std::vector<GtkWidget*> bars_;\n';
  const loop = mac
    ? '      if (downloading) [bar setDoubleValue:download_progress("")];\n    }\n'
    : '      if (downloading) gtk_progress_bar_set_fraction(GTK_PROGRESS_BAR(bar), download_progress(""));\n    }\n';
  const anchor = mac ? '  void bind_download(NSProgressIndicator* bar) { bars_.push_back(bar); }\n' : '  void add_download_bar(GtkWidget* bar) { bars_.push_back(bar); }\n';
  return source
    .replace(anchor, `${anchor}  // A button that waits for the download: disabled while a language pack is being fetched.\n  void bind_download_button(${button} button) { waiting_.push_back(button); }\n`)
    .replace(loop, `${loop}    for (${button} button : waiting_) ${state};\n`)
    .replace(`  ${bars}`, `  ${bars}  std::vector<${button}> waiting_;\n`);
}

// Puts the members in the Surface class: before its first private section.
export function withStepMembers(source: string, ir: Ir, flavor: 'macos' | 'linux'): string {
  const members = stepMembers(ir, flavor);
  const withMembers = members === '' ? source : source.replace('\n private:', `${members}\n private:`);
  return hasWaitingButton(ir) ? withWaitingButtons(withMembers, flavor) : withMembers;
}
