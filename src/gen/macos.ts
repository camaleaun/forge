import type { Ir, Node, Style } from '../ir/types.ts';
import { textOf } from '../ir/text.ts';
import { objcString } from './escape.ts';

const DEFAULT_WIDTH = 320;
const DEFAULT_HEIGHT = 120;
const INDENT = '    ';

type Axis = { horizontal: boolean };

const num = (value: unknown): number | undefined => (typeof value === 'number' ? value : undefined);
const str = (value: unknown): string | undefined => (typeof value === 'string' ? value : undefined);

// '#rrggbbaa' -> an sRGB NSColor expression.
function colorExpr(hex: string): string {
  const channel = (offset: number) => Number((parseInt(hex.slice(offset, offset + 2), 16) / 255).toFixed(4));
  const [r, g, b, a] = [1, 3, 5, 7].map(channel);
  return `[NSColor colorWithSRGBRed:${r} green:${g} blue:${b} alpha:${a}]`;
}

function orientation(axis: Axis): string {
  return axis.horizontal ? 'Horizontal' : 'Vertical';
}

function alignment(style: Style, axis: Axis): string {
  const names = axis.horizontal
    ? { start: 'Top', center: 'CenterY', end: 'Bottom', stretch: 'Top' }
    : { start: 'Leading', center: 'CenterX', end: 'Trailing', stretch: 'Leading' };
  return `NSLayoutAttribute${names[(str(style.alignItems) ?? 'stretch') as keyof typeof names]}`;
}

function gravity(style: Style, axis: Axis): string {
  const names = axis.horizontal
    ? { start: 'Leading', center: 'Center', end: 'Trailing' }
    : { start: 'Top', center: 'Center', end: 'Bottom' };
  return `NSStackViewGravity${names[(str(style.justifyContent) ?? 'start') as keyof typeof names] ?? names.start}`;
}

function distribution(node: Node): 'Fill' | 'EqualSpacing' | 'GravityAreas' {
  if (node.children.some((child) => (num(child.style.flex) ?? 0) > 0)) return 'Fill';
  return node.style.justifyContent === 'space-between' ? 'EqualSpacing' : 'GravityAreas';
}

function sizeConstraints(node: Node, v: string): string[] {
  const lines: string[] = [];
  const width = num(node.style.width);
  const height = num(node.style.height);
  if (width !== undefined) lines.push(`[[[${v} widthAnchor] constraintEqualToConstant:${width}] setActive:YES];`);
  if (height !== undefined) lines.push(`[[[${v} heightAnchor] constraintEqualToConstant:${height}] setActive:YES];`);
  return lines;
}

class Emitter {
  readonly ir: Ir;
  readonly lines: string[] = [];
  buttonHandlers: (string | undefined)[] = [];

  constructor(ir: Ir) {
    this.ir = ir;
  }

  emit(...lines: string[]): void {
    for (const line of lines) this.lines.push(line === '' ? '' : INDENT + line);
  }

  initialText(stateId: string): string {
    const initial = this.ir.states.find((state) => state.id === stateId)?.initial;
    return initial ? textOf(initial) : '';
  }

  // Emits `text` or `button` content: the initial value, plus a binding when it follows a state.
  content(node: Node, v: string, isButton: boolean): void {
    const setter = isButton ? 'setTitle' : 'setStringValue';
    const content = node.content;
    if (content?.kind === 'state') {
      this.emit(`[${v} ${setter}:${objcString(this.initialText(content.state))}];`);
      this.emit(`g_surface.bind(StateId::${content.state}, ${v}, ${isButton});`);
    } else {
      this.emit(`[${v} ${setter}:${objcString(content ? textOf(content) : '')}];`);
    }
  }

  font(node: Node, v: string): void {
    const fontSize = num(node.style.fontSize);
    const weight = num(node.style.fontWeight);
    if (fontSize === undefined && weight === undefined) return;
    const pointSize = fontSize === undefined ? '[NSFont systemFontSize]' : String(fontSize);
    const fontWeight = weight === 700 ? 'NSFontWeightBold' : 'NSFontWeightRegular';
    this.emit(`[${v} setFont:[NSFont systemFontOfSize:${pointSize} weight:${fontWeight}]];`);
  }

  // Adds `node` to `parent`, then emits the constraints that need the shared hierarchy.
  attach(node: Node, v: string, parent: Node, p: string): void {
    const axis = { horizontal: parent.style.flexDirection === 'row' };
    if (distribution(parent) === 'GravityAreas') this.emit(`[${p} addView:${v} inGravity:${gravity(parent.style, axis)}];`);
    else this.emit(`[${p} addArrangedSubview:${v}];`);

    for (const line of sizeConstraints(node, v)) this.emit(line);
    const stretch = (str(parent.style.alignItems) ?? 'stretch') === 'stretch';
    const crossSize = axis.horizontal ? 'height' : 'width';
    if (stretch && num(node.style[crossSize]) === undefined) {
      const padding = (parent.style.padding as number[] | undefined) ?? [0, 0, 0, 0];
      const inset = axis.horizontal ? padding[0] + padding[2] : padding[1] + padding[3];
      const constant = inset > 0 ? ` constant:-${inset}` : '';
      this.emit(`[[[${v} ${crossSize}Anchor] constraintEqualToAnchor:[${p} ${crossSize}Anchor]${constant}] setActive:YES];`);
    }
    if ((num(node.style.flex) ?? 0) > 0) {
      this.emit(`[${v} setContentHuggingPriority:1 forOrientation:NSLayoutConstraintOrientation${orientation(axis)}];`);
    }
  }

  container(node: Node, parent: Node | undefined): void {
    const v = `w_${node.id}`;
    const axis = { horizontal: node.style.flexDirection === 'row' };
    const padding = (node.style.padding as number[] | undefined) ?? [0, 0, 0, 0];
    this.emit(`NSStackView* ${v} = [[NSStackView alloc] init];`);
    this.emit(`[${v} setTranslatesAutoresizingMaskIntoConstraints:NO];`);
    this.emit(`[${v} setOrientation:NSUserInterfaceLayoutOrientation${orientation(axis)}];`);
    this.emit(`[${v} setSpacing:${num(node.style.gap) ?? 0}];`);
    this.emit(`[${v} setEdgeInsets:NSEdgeInsetsMake(${padding[0]}, ${padding[3]}, ${padding[2]}, ${padding[1]})];`);
    this.emit(`[${v} setAlignment:${alignment(node.style, axis)}];`);
    this.emit(`[${v} setDistribution:NSStackViewDistribution${distribution(node)}];`);
    const background = str(node.style.background);
    const radius = num(node.style.borderRadius);
    if (background !== undefined || radius !== undefined) {
      this.emit(`[${v} setWantsLayer:YES];`);
      if (background !== undefined) this.emit(`[[${v} layer] setBackgroundColor:[${colorExpr(background)} CGColor]];`);
      if (radius !== undefined) {
        this.emit(`[[${v} layer] setCornerRadius:${radius}];`);
        this.emit(`[[${v} layer] setMasksToBounds:YES];`);
      }
    }
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

  text(node: Node, parent: Node): void {
    const v = `w_${node.id}`;
    this.emit(`NSTextField* ${v} = [NSTextField labelWithString:@""];`);
    this.font(node, v);
    const color = str(node.style.color);
    if (color !== undefined) this.emit(`[${v} setTextColor:${colorExpr(color)}];`);
    const align = str(node.style.textAlign);
    if (align !== undefined) this.emit(`[${v} setAlignment:NSTextAlignment${align[0].toUpperCase()}${align.slice(1)}];`);
    this.content(node, v, false);
    this.attach(node, v, parent, `w_${parent.id}`);
  }

  button(node: Node, parent: Node): void {
    const v = `w_${node.id}`;
    const tag = this.buttonHandlers.length;
    this.buttonHandlers.push(node.on?.click);
    this.emit(`NSButton* ${v} = [[NSButton alloc] init];`);
    this.emit(`[${v} setBezelStyle:NSBezelStyleRounded];`);
    this.font(node, v);
    this.content(node, v, true);
    this.emit(`[${v} setTag:${tag}];`, `[${v} setTarget:target];`, `[${v} setAction:@selector(invoke:)];`);
    this.attach(node, v, parent, `w_${parent.id}`);
  }

  node(node: Node, parent: Node | undefined): void {
    if (node.kind === 'text' && parent) this.text(node, parent);
    else if (node.kind === 'button' && parent) this.button(node, parent);
    else this.container(node, parent);
  }
}

export function generateMacosUi(ir: Ir): string {
  const { root } = ir;
  const width = num(root.style.width) ?? DEFAULT_WIDTH;
  const height = num(root.style.height) ?? DEFAULT_HEIGHT;
  const emitter = new Emitter(ir);
  emitter.node(root, undefined);
  const cases = emitter.buttonHandlers
    .map((handler, tag) => (handler === undefined ? '' : `    case ${tag}:\n      action_${handler}(g_surface);\n      break;\n`))
    .join('');
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
