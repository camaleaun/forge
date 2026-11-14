import type { Ir, Node } from '../ir/types.ts';
import { textOf } from '../ir/text.ts';
import { cppString, objcString } from './escape.ts';
import type { I18nGenOptions } from './i18n-options.ts';
import { AUTO, assertNoSteps, checkProgressSources, effective, languageChoices, layoutOf, varies } from './layout.ts';
import type { LayoutNode } from './layout.ts';
import { textExpr } from './text-cpp.ts';

const DEFAULT_WIDTH = 320;
const DEFAULT_HEIGHT = 120;
const INDENT = '    ';

type Axis = { horizontal: boolean };

// '#rrggbbaa' -> an sRGB NSColor expression.
function colorExpr(hex: string): string {
  const channel = (offset: number) => Number((parseInt(hex.slice(offset, offset + 2), 16) / 255).toFixed(4));
  const [r, g, b, a] = [1, 3, 5, 7].map(channel);
  return `[NSColor colorWithSRGBRed:${r} green:${g} blue:${b} alpha:${a}]`;
}

function orientation(axis: Axis): string {
  return axis.horizontal ? 'Horizontal' : 'Vertical';
}

function alignmentFor(align: LayoutNode['align'], horizontal: boolean): string {
  const names = horizontal
    ? { start: 'Top', center: 'CenterY', end: 'Bottom', stretch: 'Top' }
    : { start: 'Leading', center: 'CenterX', end: 'Trailing', stretch: 'Leading' };
  return `NSLayoutAttribute${names[align]}`;
}

function alignment(node: LayoutNode): string {
  return alignmentFor(node.align, node.horizontal);
}

const bool = (value: boolean): string => (value ? 'YES' : 'NO');
const cap = (word: string): string => word[0].toUpperCase() + word.slice(1);

function gravity(node: LayoutNode): string {
  const names = node.horizontal
    ? { start: 'Leading', center: 'Center', end: 'Trailing' }
    : { start: 'Top', center: 'Center', end: 'Bottom' };
  return `NSStackViewGravity${names[node.justify === 'space-between' ? 'start' : node.justify]}`;
}

function distribution(node: LayoutNode): 'Fill' | 'EqualSpacing' | 'GravityAreas' {
  if (node.children.some((child) => child.grow)) return 'Fill';
  return node.justify === 'space-between' ? 'EqualSpacing' : 'GravityAreas';
}

function sizeConstraints(node: LayoutNode, v: string): string[] {
  const lines: string[] = [];
  if (node.width !== undefined) lines.push(`[[[${v} widthAnchor] constraintEqualToConstant:${node.width}] setActive:YES];`);
  if (node.height !== undefined) lines.push(`[[[${v} heightAnchor] constraintEqualToConstant:${node.height}] setActive:YES];`);
  return lines;
}

function hasSelect(node: Node): boolean {
  return node.kind === 'select' || node.children.some(hasSelect);
}

class Emitter {
  readonly ir: Ir;
  readonly lines: string[] = [];
  // The body of the block that applies @media variants for a window of w by h (see apply()).
  readonly variantLines: string[] = [];
  buttonHandlers: (string | undefined)[] = [];

  readonly i18n: I18nGenOptions | undefined;

  constructor(ir: Ir, i18n?: I18nGenOptions) {
    this.ir = ir;
    this.i18n = i18n;
  }

  emit(...lines: string[]): void {
    for (const line of lines) this.lines.push(line === '' ? '' : INDENT + line);
  }

  initialText(stateId: string): string {
    const initial = this.ir.states.find((state) => state.id === stateId)?.initial;
    return initial ? textOf(initial) : '';
  }

  // Emits `text` or `button` content: the initial value, plus a binding when it follows a state.
  content(node: LayoutNode, v: string, isButton: boolean): void {
    const setter = isButton ? 'setTitle' : 'setStringValue';
    const content = node.content;
    if (this.i18n && content && content.kind !== 'literal') {
      const kind = isButton ? 'Button' : 'Label';
      if (content.kind === 'state') this.emit(`g_surface.bind_state(Kind::${kind}, ${v}, StateId::${content.state});`);
      else this.emit(`g_surface.bind_text(Kind::${kind}, ${v}, ${textExpr(this.ir, content)});`);
      return;
    }
    if (content?.kind === 'state') {
      this.emit(`[${v} ${setter}:${objcString(this.initialText(content.state))}];`);
      this.emit(`g_surface.bind(StateId::${content.state}, ${v}, ${isButton});`);
    } else {
      this.emit(`[${v} ${setter}:${objcString(content ? textOf(content) : '')}];`);
    }
  }

  font(node: LayoutNode, v: string): void {
    const { fontSize, fontWeight: weight } = node.paint;
    if (fontSize === undefined && weight === undefined) return;
    const pointSize = fontSize === undefined ? '[NSFont systemFontSize]' : String(fontSize);
    const fontWeight = weight === 700 ? 'NSFontWeightBold' : 'NSFontWeightRegular';
    this.emit(`[${v} setFont:[NSFont systemFontOfSize:${pointSize} weight:${fontWeight}]];`);
  }

  // Lines of the variants block: they run on every window size change.
  vary(...lines: string[]): void {
    for (const line of lines) this.variantLines.push(line === '' ? '' : `${INDENT}  ${line}`);
  }

  // The expression of the effective width or height (AUTO when none) at the current window size.
  size(node: LayoutNode, key: 'width' | 'height'): string {
    return effective(node, key, String(node[key] ?? AUTO), String);
  }

  // The expression of the parent's direction at the current window size.
  horizontalOf(parent: LayoutNode): string {
    return varies(parent, 'horizontal') ? `hz_${parent.id}` : bool(parent.horizontal);
  }

  // A child whose size, growth or stretching follows the window: its constraints are built here and set by apply().
  followsWindow(node: LayoutNode, parent: LayoutNode): boolean {
    return varies(parent, 'horizontal') || varies(node, 'width') || varies(node, 'height') || varies(node, 'grow') || (parent.align === 'stretch' && varies(parent, 'padding'));
  }

  attachVariants(node: LayoutNode, v: string, parent: LayoutNode, p: string): void {
    const id = node.id;
    for (const key of ['width', 'height'] as const) {
      if (varies(node, key)) this.emit(`NSLayoutConstraint* c${key[0]}_${id} = [[${v} ${key}Anchor] constraintEqualToConstant:0];`, `[c${key[0]}_${id} setActive:NO];`);
      else if (node[key] !== undefined) this.emit(`[[[${v} ${key}Anchor] constraintEqualToConstant:${node[key]}] setActive:YES];`);
    }
    const stretch = parent.align === 'stretch';
    if (stretch) {
      for (const key of ['width', 'height'] as const) this.emit(`NSLayoutConstraint* s${key[0]}_${id} = [[${v} ${key}Anchor] constraintEqualToAnchor:[${p} ${key}Anchor]];`, `[s${key[0]}_${id} setActive:NO];`);
    }
    const hz = this.horizontalOf(parent);
    const sum = (a: number, b: number) =>
      `(${[a, b].map((i) => effective(parent, 'padding', String(parent.padding[i]), (value) => String(value[i]))).join(' + ')})`;
    this.vary('{');
    for (const key of ['width', 'height'] as const) {
      if (stretch || varies(node, key)) this.vary(`  const CGFloat ${key} = ${this.size(node, key)};`);
    }
    for (const key of ['width', 'height'] as const) {
      if (varies(node, key)) this.vary(`  [c${key[0]}_${id} setActive:${key} >= 0];`, `  if (${key} >= 0) [c${key[0]}_${id} setConstant:${key}];`);
    }
    if (stretch) {
      this.vary(`  [sh_${id} setActive:${hz} && height < 0];`, `  [sh_${id} setConstant:-${sum(0, 2)}];`);
      this.vary(`  [sw_${id} setActive:!${hz} && width < 0];`, `  [sw_${id} setConstant:-${sum(1, 3)}];`);
    }
    this.vary(
      `  const BOOL grow = ${effective(node, 'grow', bool(node.grow), bool)};`,
      `  [${v} setContentHuggingPriority:(grow && ${hz}) ? 1 : 250 forOrientation:NSLayoutConstraintOrientationHorizontal];`,
      `  [${v} setContentHuggingPriority:(grow && !${hz}) ? 1 : 250 forOrientation:NSLayoutConstraintOrientationVertical];`,
      '}',
    );
  }

  // Applies what varies on a box: direction, gap, padding, background, radius and whether a child grows.
  boxVariants(node: LayoutNode, v: string): void {
    const id = node.id;
    if (varies(node, 'horizontal')) {
      this.vary(
        `const BOOL hz_${id} = ${effective(node, 'horizontal', bool(node.horizontal), bool)};`,
        `[${v} setOrientation:hz_${id} ? NSUserInterfaceLayoutOrientationHorizontal : NSUserInterfaceLayoutOrientationVertical];`,
        `[${v} setAlignment:hz_${id} ? ${alignmentFor(node.align, true)} : ${alignmentFor(node.align, false)}];`,
      );
    }
    if (varies(node, 'gap')) this.vary(`[${v} setSpacing:${effective(node, 'gap', String(node.gap), String)}];`);
    if (varies(node, 'padding')) {
      const side = (i: number) => effective(node, 'padding', String(node.padding[i]), (value) => String(value[i]));
      this.vary(`[${v} setEdgeInsets:NSEdgeInsetsMake(${side(0)}, ${side(3)}, ${side(2)}, ${side(1)})];`);
    }
    if (varies(node, 'background')) {
      const base = node.paint.background === undefined ? '[NSColor clearColor]' : colorExpr(node.paint.background);
      this.vary(`[[${v} layer] setBackgroundColor:[${effective(node, 'background', base, colorExpr)} CGColor]];`);
    }
    if (varies(node, 'radius')) this.vary(`[[${v} layer] setCornerRadius:${effective(node, 'radius', String(node.paint.radius ?? 0), String)}];`);
    if (node.children.some((child) => varies(child, 'grow'))) {
      const anyGrow = node.children.map((child) => effective(child, 'grow', bool(child.grow), bool)).join(' || ');
      const idle = node.justify === 'space-between' ? 'EqualSpacing' : 'GravityAreas';
      this.vary(`[${v} setDistribution:(${anyGrow}) ? NSStackViewDistributionFill : NSStackViewDistribution${idle}];`);
    }
  }

  // Text, buttons and pop-ups: font and (for text) colour and alignment follow the window size.
  textVariants(node: LayoutNode, v: string): void {
    if (varies(node, 'fontSize') || varies(node, 'fontWeight')) {
      const size = effective(node, 'fontSize', node.paint.fontSize === undefined ? '[NSFont systemFontSize]' : String(node.paint.fontSize), String);
      const weight = effective(node, 'fontWeight', String(node.paint.fontWeight ?? 400), String);
      this.vary(`[${v} setFont:[NSFont systemFontOfSize:${size} weight:(${weight} == 700 ? NSFontWeightBold : NSFontWeightRegular)]];`);
    }
    if (node.kind !== 'text') return;
    if (varies(node, 'color')) {
      const base = node.paint.color === undefined ? '[NSColor labelColor]' : colorExpr(node.paint.color);
      this.vary(`[${v} setTextColor:${effective(node, 'color', base, colorExpr)}];`);
    }
    if (varies(node, 'textAlign')) {
      const name = (align: string) => `NSTextAlignment${cap(align)}`;
      this.vary(`[${v} setAlignment:${effective(node, 'textAlign', node.paint.textAlign === undefined ? 'NSTextAlignmentNatural' : name(node.paint.textAlign), name)}];`);
    }
  }

  // Adds `node` to `parent`, then emits the constraints that need the shared hierarchy.
  attach(node: LayoutNode, v: string, parent: LayoutNode, p: string): void {
    const axis = { horizontal: parent.horizontal };
    if (distribution(parent) === 'GravityAreas') this.emit(`[${p} addView:${v} inGravity:${gravity(parent)}];`);
    else this.emit(`[${p} addArrangedSubview:${v}];`);

    if (this.followsWindow(node, parent)) {
      this.attachVariants(node, v, parent, p);
      return;
    }
    for (const line of sizeConstraints(node, v)) this.emit(line);
    if (node.stretchInset !== undefined) {
      const crossSize = axis.horizontal ? 'height' : 'width';
      const constant = node.stretchInset > 0 ? ` constant:-${node.stretchInset}` : '';
      this.emit(`[[[${v} ${crossSize}Anchor] constraintEqualToAnchor:[${p} ${crossSize}Anchor]${constant}] setActive:YES];`);
    }
    if (node.grow) {
      this.emit(`[${v} setContentHuggingPriority:1 forOrientation:NSLayoutConstraintOrientation${orientation(axis)}];`);
    }
  }

  container(node: LayoutNode, parent: LayoutNode | undefined): void {
    const v = `w_${node.id}`;
    const axis = { horizontal: node.horizontal };
    const { padding } = node;
    this.emit(`NSStackView* ${v} = [[NSStackView alloc] init];`);
    this.emit(`[${v} setTranslatesAutoresizingMaskIntoConstraints:NO];`);
    this.emit(`[${v} setOrientation:NSUserInterfaceLayoutOrientation${orientation(axis)}];`);
    this.emit(`[${v} setSpacing:${node.gap}];`);
    this.emit(`[${v} setEdgeInsets:NSEdgeInsetsMake(${padding[0]}, ${padding[3]}, ${padding[2]}, ${padding[1]})];`);
    this.emit(`[${v} setAlignment:${alignment(node)}];`);
    this.emit(`[${v} setDistribution:NSStackViewDistribution${distribution(node)}];`);
    const { background, radius } = node.paint;
    if (background !== undefined || radius !== undefined || varies(node, 'background') || varies(node, 'radius')) {
      this.emit(`[${v} setWantsLayer:YES];`);
      if (background !== undefined) this.emit(`[[${v} layer] setBackgroundColor:[${colorExpr(background)} CGColor]];`);
      if (radius !== undefined) this.emit(`[[${v} layer] setCornerRadius:${radius}];`);
      if (radius !== undefined || varies(node, 'radius')) this.emit(`[[${v} layer] setMasksToBounds:YES];`);
    }
    this.boxVariants(node, v);
    if (parent === undefined) {
      this.emit(
        `[content addSubview:${v}];`,
        '[NSLayoutConstraint activateConstraints:@[',
        ...['top', 'leading', 'bottom', 'trailing'].map(
          (side) => `  [[${v} ${side}Anchor] constraintEqualToAnchor:[content ${side}Anchor]],`,
        ),
        ']];',
      );
    } else {
      this.attach(node, v, parent, `w_${parent.id}`);
    }
    for (const child of node.children) {
      this.emit('');
      this.node(child, node);
    }
  }

  text(node: LayoutNode, parent: LayoutNode): void {
    const v = `w_${node.id}`;
    this.emit(`NSTextField* ${v} = [NSTextField labelWithString:@""];`);
    this.font(node, v);
    this.textVariants(node, v);
    const { color } = node.paint;
    if (color !== undefined) this.emit(`[${v} setTextColor:${colorExpr(color)}];`);
    const align = node.paint.textAlign;
    if (align !== undefined) this.emit(`[${v} setAlignment:NSTextAlignment${align[0].toUpperCase()}${align.slice(1)}];`);
    this.content(node, v, false);
    this.attach(node, v, parent, `w_${parent.id}`);
  }

  button(node: LayoutNode, parent: LayoutNode): void {
    const v = `w_${node.id}`;
    const tag = this.buttonHandlers.length;
    this.buttonHandlers.push(node.handler);
    this.emit(`NSButton* ${v} = [[NSButton alloc] init];`);
    this.emit(`[${v} setBezelStyle:NSBezelStyleRounded];`);
    this.font(node, v);
    this.textVariants(node, v);
    this.content(node, v, true);
    this.emit(`[${v} setTag:${tag}];`, `[${v} setTarget:target];`, `[${v} setAction:@selector(invoke:)];`);
    this.attach(node, v, parent, `w_${parent.id}`);
  }

  // <select language>: a pop-up of English plus one item per language pack; it follows the active language.
  select(node: LayoutNode, parent: LayoutNode): void {
    const v = `w_${node.id}`;
    this.emit(`NSPopUpButton* ${v} = [[NSPopUpButton alloc] initWithFrame:NSZeroRect pullsDown:NO];`);
    this.emit(`[[${v} menu] setAutoenablesItems:NO];`);
    this.font(node, v);
    this.textVariants(node, v);
    for (const [value, name] of node.languages ?? []) {
      this.emit(`add_language_item([${v} menu], ${v}, target, ${cppString(value)}, Text(${cppString(name)}));`);
    }
    this.attach(node, v, parent, `w_${parent.id}`);
  }

  // <progress>: a bar NSProgressIndicator. A language-download bar is hidden (it takes no space in the stack)
  // until a download runs; the surface shows it and sets its value. The system draws the fill, so `color` is not applied.
  progress(node: LayoutNode, parent: LayoutNode): void {
    const v = `w_${node.id}`;
    const data = node.progress ?? {};
    this.emit(`NSProgressIndicator* ${v} = [[NSProgressIndicator alloc] init];`);
    this.emit(`[${v} setStyle:NSProgressIndicatorStyleBar];`);
    if (data.indeterminate) {
      this.emit(`[${v} setIndeterminate:YES];`, `[${v} startAnimation:nil];`);
    } else {
      this.emit(`[${v} setIndeterminate:NO];`, `[${v} setMinValue:0];`, `[${v} setMaxValue:${data.max ?? 1}];`);
      if (data.source === 'language-download') this.emit(`g_surface.bind_download(${v});`);
      else this.emit(`[${v} setDoubleValue:${data.value ?? 0}];`);
    }
    this.attach(node, v, parent, `w_${parent.id}`);
  }

  node(node: LayoutNode, parent: LayoutNode | undefined): void {
    if (node.kind === 'progress' && parent) this.progress(node, parent);
    else if (node.kind === 'select' && parent) this.select(node, parent);
    else if (node.kind === 'text' && parent) this.text(node, parent);
    else if (node.kind === 'button' && parent) this.button(node, parent);
    else this.container(node, parent);
  }
}

export function generateMacosUi(ir: Ir, i18n?: I18nGenOptions): string {
  const { root } = ir;
  assertNoSteps(root, 'macos');
  if (hasSelect(root) && (!i18n || i18n.packs.length === 0)) throw new Error('<select language> needs at least one language pack');
  checkProgressSources(root, i18n !== undefined);
  const layout = layoutOf(root, languageChoices(i18n));
  const width = layout.width ?? DEFAULT_WIDTH;
  const height = layout.height ?? DEFAULT_HEIGHT;
  const emitter = new Emitter(ir, i18n);
  emitter.node(layout, undefined);
  const cases = emitter.buttonHandlers
    .map((handler, tag) => (handler === undefined ? '' : `    case ${tag}:\n      action_${handler}(g_surface);\n      break;\n`))
    .join('');
  const ui = i18n ? i18nUi(ir, i18n, emitter, width, height, cases) : plainUi(ir, emitter, width, height, cases);
  return emitter.variantLines.length === 0 ? ui : withVariants(ui, emitter);
}

// @media variants: a block with the code that applies them runs at start and whenever the window is resized.
function withVariants(source: string, emitter: Emitter): string {
  const apply = `    g_apply = ^(CGFloat w, CGFloat h) {
      (void)w;
      (void)h;
${emitter.variantLines.join('\n')}
    };
    [window setDelegate:target];
    g_apply([content frame].size.width, [content frame].size.height);

`;
  const resize = `@implementation ForgeTarget

// The window size, not the screen, is what @media measures.
- (void)windowDidResize:(NSNotification*)notification {
  const NSSize size = [[(NSWindow*)[notification object] contentView] frame].size;
  if (g_apply) g_apply(size.width, size.height);
}
`;
  return source
    .replace('@interface ForgeTarget : NSObject <NSApplicationDelegate>', 'static void (^g_apply)(CGFloat, CGFloat);\n\n@interface ForgeTarget : NSObject <NSApplicationDelegate, NSWindowDelegate>')
    .replace('@implementation ForgeTarget\n', resize)
    .replace('    [window makeKeyAndOrderFront:nil];', `${apply}    [window makeKeyAndOrderFront:nil];`);
}

function plainUi(ir: Ir, emitter: Emitter, width: number, height: number, cases: string): string {
  const { root } = ir;
  return `// Generated by forge. Do not edit.
#import <Cocoa/Cocoa.h>

#include <vector>

#include "forge_app.hpp"

using namespace forge_app;

namespace {

class CocoaSurface : public Surface {
 public:
  void bind(StateId id, NSControl* control, bool is_title) { bindings_.push_back({id, control, is_title}); }

  void set_state(StateId id, const char* text) override {
    NSString* value = [NSString stringWithUTF8String:text];
    for (const Binding& binding : bindings_) {
      if (binding.id != id) continue;
      if (binding.is_title) {
        [(NSButton*)binding.control setTitle:value];
      } else {
        [binding.control setStringValue:value];
      }
    }
  }

 private:
  struct Binding {
    StateId id;
    NSControl* control;
    bool is_title;
  };
  std::vector<Binding> bindings_;
};

CocoaSurface g_surface;

}  // namespace

@interface ForgeTarget : NSObject <NSApplicationDelegate>
- (void)invoke:(NSButton*)sender;
@end

@implementation ForgeTarget

- (void)invoke:(NSButton*)sender {
  switch (sender.tag) {
${cases}  }
}

- (BOOL)applicationShouldTerminateAfterLastWindowClosed:(NSApplication*)app {
  return YES;
}

@end

int forge_app::run_ui(int argc, char** argv) {
  (void)argc;
  (void)argv;
  @autoreleasepool {
    NSApplication* app = [NSApplication sharedApplication];
    [app setActivationPolicy:NSApplicationActivationPolicyRegular];
    ForgeTarget* target = [[ForgeTarget alloc] init];
    [app setDelegate:target];

    NSMenu* menubar = [[NSMenu alloc] init];
    NSMenuItem* appItem = [[NSMenuItem alloc] init];
    [menubar addItem:appItem];
    NSMenu* appMenu = [[NSMenu alloc] init];
    [appMenu addItemWithTitle:${objcString(`Quit ${ir.app.name}`)} action:@selector(terminate:) keyEquivalent:@"q"];
    [appItem setSubmenu:appMenu];
    [app setMainMenu:menubar];

    NSWindow* window = [[NSWindow alloc]
        initWithContentRect:NSMakeRect(0, 0, ${width}, ${height})
                  styleMask:(NSWindowStyleMaskTitled | NSWindowStyleMaskClosable | NSWindowStyleMaskMiniaturizable |
                             NSWindowStyleMaskResizable)
                    backing:NSBackingStoreBuffered
                      defer:NO];
    [window setTitle:${objcString(root.title ? textOf(root.title) : ir.app.name)}];
    [window setContentMinSize:NSMakeSize(${width}, ${height})];
    [window center];
    NSView* content = [window contentView];

${emitter.lines.join('\n')}

    [window makeKeyAndOrderFront:nil];
    [app activateIgnoringOtherApps:YES];
    [app run];
  }
  return 0;
}
`;
}

const I18N_SURFACE = `// Generated by forge. Do not edit.
#import <Cocoa/Cocoa.h>

#include <string>
#include <vector>

#include "forge_app.hpp"

using namespace forge_app;

namespace {

enum class Kind { Label, Button, Window, MenuItem, Menu };

class CocoaSurface : public Surface {
 public:
  // A control, window or menu whose text is a fixed message, or follows a state.
  void bind_text(Kind kind, id object, const Text& text) { bound_.push_back({kind, object, -1, text}); }
  void bind_state(Kind kind, id object, StateId state) { bound_.push_back({kind, object, static_cast<int>(state), Text()}); }
  // A language choice: a menu item (checked = the stored choice) or an item of a pop-up (selected = the active language).
  void bind_language(NSMenuItem* item, NSPopUpButton* popup, const char* value, const Text& name) {
    choices_.push_back({item, popup, value, name});
  }

  // A bar that shows the language download: hidden (and out of the layout) until one runs.
  void bind_download(NSProgressIndicator* bar) { bars_.push_back(bar); }

  void set_state(StateId id, const Text& text) override {
    const std::size_t index = static_cast<std::size_t>(id);
    if (states_.size() <= index) states_.resize(index + 1);
    states_[index] = text;
    refresh_all();
  }

  // Renders every text again: after the window is built, when a state changes and when the language changes.
  void refresh_all() {
    for (const Bound& bound : bound_) {
      const std::size_t state = static_cast<std::size_t>(bound.state);
      const Text& text = bound.state < 0 ? bound.text : (state < states_.size() ? states_[state] : empty_);
      NSString* value = ns(render(text));
      switch (bound.kind) {
        case Kind::Label: [(NSTextField*)bound.object setStringValue:value]; break;
        case Kind::Button: [(NSButton*)bound.object setTitle:value]; break;
        case Kind::Window: [(NSWindow*)bound.object setTitle:value]; break;
        case Kind::MenuItem: [(NSMenuItem*)bound.object setTitle:value]; break;
        case Kind::Menu: [(NSMenu*)bound.object setTitle:value]; break;
      }
    }
    const std::string active = active_language();
    const std::string stored = stored_language();
    for (const Choice& choice : choices_) {
      const bool offline = !choice.value.empty() && language_offline(choice.value);
      std::string name = render(choice.name);
      if (offline) name += render(Text::tr(" (offline)"));
      [choice.item setTitle:ns(name)];
      [choice.item setEnabled:!offline];
      if (choice.popup) {
        if (choice.value == active) [choice.popup selectItem:choice.item];
      } else {
        [choice.item setState:choice.value == stored ? NSControlStateValueOn : NSControlStateValueOff];
      }
    }
    const bool downloading = download_active();
    for (NSProgressIndicator* bar : bars_) {
      [bar setHidden:!downloading];
      if (downloading) [bar setDoubleValue:download_progress("")];
    }
  }

 private:
  struct Bound {
    Kind kind;
    id object;
    int state;
    Text text;
  };
  struct Choice {
    NSMenuItem* item;
    NSPopUpButton* popup;
    std::string value;
    Text name;
  };
  static NSString* ns(const std::string& text) { return [NSString stringWithUTF8String:text.c_str()]; }

  std::vector<Bound> bound_;
  std::vector<Choice> choices_;
  std::vector<NSProgressIndicator*> bars_;
  std::vector<Text> states_;
  Text empty_;
};

CocoaSurface g_surface;

}  // namespace

@interface ForgeTarget : NSObject <NSApplicationDelegate>
- (void)invoke:(NSButton*)sender;
- (void)chooseLanguage:(NSMenuItem*)sender;
@end

namespace {

void add_language_item(NSMenu* menu, NSPopUpButton* popup, ForgeTarget* target, const char* value, const Text& name) {
  NSMenuItem* item = [menu addItemWithTitle:@"" action:@selector(chooseLanguage:) keyEquivalent:@""];
  [item setTarget:target];
  [item setRepresentedObject:[NSString stringWithUTF8String:value]];
  g_surface.bind_language(item, popup, value, name);
}

}  // namespace
`;

// The Language menu of the menu bar (optional; the in-window dropdown is the main selector).
function languageMenu(i18n: I18nGenOptions): string {
  const items = [
    `add_language_item(languageMenu, nil, target, "", Text::tr("Auto (system language)"));`,
    ...languageChoices(i18n).map(([value, name]) => `add_language_item(languageMenu, nil, target, ${cppString(value)}, Text(${cppString(name)}));`),
  ];
  return `
    NSMenuItem* languageItem = [[NSMenuItem alloc] init];
    [menubar addItem:languageItem];
    NSMenu* languageMenu = [[NSMenu alloc] initWithTitle:@"Language"];
    [languageMenu setAutoenablesItems:NO];
    g_surface.bind_text(Kind::Menu, languageMenu, Text::tr("Language"));
${items.map((item) => `    ${item}`).join('\n')}
    [languageItem setSubmenu:languageMenu];
`;
}

function i18nUi(ir: Ir, i18n: I18nGenOptions, emitter: Emitter, width: number, height: number, cases: string): string {
  const title = ir.root.title;
  const windowTitle =
    title === undefined
      ? `[window setTitle:${objcString(ir.app.name)}];`
      : title.kind === 'literal'
        ? `[window setTitle:${objcString(title.value)}];`
        : `g_surface.bind_text(Kind::Window, window, ${textExpr(ir, title)});`;
  const initialStates = ir.states.map((state) => `    g_surface.set_state(StateId::${state.id}, ${textExpr(ir, state.initial)});\n`).join('');
  return `${I18N_SURFACE}
@implementation ForgeTarget

- (void)invoke:(NSButton*)sender {
  switch (sender.tag) {
${cases}  }
}

- (void)chooseLanguage:(NSMenuItem*)sender {
  choose_language([(NSString*)[sender representedObject] UTF8String]);
}

- (BOOL)applicationShouldTerminateAfterLastWindowClosed:(NSApplication*)app {
  return YES;
}

@end

int forge_app::run_ui(int argc, char** argv) {
  (void)argc;
  (void)argv;
  @autoreleasepool {
    // A cached language pack is applied before the window exists, so there is no flash of English.
    set_refresh_hook([] { g_surface.refresh_all(); });
    start_gui_language();
${initialStates}
    NSApplication* app = [NSApplication sharedApplication];
    [app setActivationPolicy:NSApplicationActivationPolicyRegular];
    ForgeTarget* target = [[ForgeTarget alloc] init];
    [app setDelegate:target];

    NSMenu* menubar = [[NSMenu alloc] init];
    NSMenuItem* appItem = [[NSMenuItem alloc] init];
    [menubar addItem:appItem];
    NSMenu* appMenu = [[NSMenu alloc] init];
    NSMenuItem* quitItem = [appMenu addItemWithTitle:@"" action:@selector(terminate:) keyEquivalent:@"q"];
    g_surface.bind_text(Kind::MenuItem, quitItem, Text::tr(${cppString(`Quit ${ir.app.name}`)}));
    [appItem setSubmenu:appMenu];
${i18n.menu ? languageMenu(i18n) : ''}    [app setMainMenu:menubar];

    NSWindow* window = [[NSWindow alloc]
        initWithContentRect:NSMakeRect(0, 0, ${width}, ${height})
                  styleMask:(NSWindowStyleMaskTitled | NSWindowStyleMaskClosable | NSWindowStyleMaskMiniaturizable |
                             NSWindowStyleMaskResizable)
                    backing:NSBackingStoreBuffered
                      defer:NO];
    ${windowTitle}
    [window setContentMinSize:NSMakeSize(${width}, ${height})];
    [window center];
    NSView* content = [window contentView];

${emitter.lines.join('\n')}

    g_surface.refresh_all();
    [window makeKeyAndOrderFront:nil];
    [app activateIgnoringOtherApps:YES];
    [app run];
  }
  return 0;
}
`;
}
