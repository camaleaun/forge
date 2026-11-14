import type { Ir, Node } from '../ir/types.ts';
import { textOf } from '../ir/text.ts';
import { cppString } from './escape.ts';
import type { I18nGenOptions } from './i18n-options.ts';
import { languageChoices, layoutOf } from './layout.ts';
import type { Align, LayoutNode } from './layout.ts';
import { textExpr } from './text-cpp.ts';

const DEFAULT_WIDTH = 320;
const DEFAULT_HEIGHT = 120;
const INDENT = '  ';

const ALIGN_NAME: Record<Align, string> = { start: 'GTK_ALIGN_START', center: 'GTK_ALIGN_CENTER', end: 'GTK_ALIGN_END', stretch: 'GTK_ALIGN_FILL' };

// '#rrggbbaa' -> a CSS rgba() value.
function rgba(hex: string): string {
  const [r, g, b, a] = [1, 3, 5, 7].map((offset) => parseInt(hex.slice(offset, offset + 2), 16));
  return `rgba(${r}, ${g}, ${b}, ${Number((a / 255).toFixed(3))})`;
}

function hasSelect(node: Node): boolean {
  return node.kind === 'select' || node.children.some(hasSelect);
}

class Emitter {
  readonly ir: Ir;
  readonly i18n: boolean;
  readonly lines: string[] = [];
  readonly css: string[] = [];
  readonly handlers: (string | undefined)[] = [];

  constructor(ir: Ir, i18n: boolean) {
    this.ir = ir;
    this.i18n = i18n;
  }

  // In i18n mode a message or a state is bound to the widget and rendered by refresh_all().
  bindContent(node: LayoutNode, v: string, isButton: boolean): boolean {
    const content = node.content;
    if (!this.i18n || content === undefined || content.kind === 'literal') return false;
    const kind = isButton ? 'Button' : 'Label';
    if (content.kind === 'state') this.emit(`g_surface.bind_state(Kind::${kind}, ${v}, StateId::${content.state});`);
    else this.emit(`g_surface.bind_text(Kind::${kind}, ${v}, ${textExpr(this.ir, content)});`);
    return true;
  }

  emit(...lines: string[]): void {
    for (const line of lines) this.lines.push(line === '' ? '' : INDENT + line);
  }

  initialText(stateId: string): string {
    const initial = this.ir.states.find((state) => state.id === stateId)?.initial;
    return initial ? textOf(initial) : '';
  }

  // Text shown at creation: a literal, or the initial value of the state it follows.
  textOf(node: LayoutNode): string {
    const { content } = node;
    if (content === undefined) return '';
    return content.kind === 'state' ? this.initialText(content.state) : textOf(content);
  }

  // One CSS rule per widget that needs padding, color, background, radius or font.
  style(node: LayoutNode, v: string): void {
    const { paint, padding } = node;
    const props: string[] = [];
    if (padding.some((side) => side > 0)) props.push(`padding: ${padding.map((side) => `${side}px`).join(' ')}`);
    if (paint.background !== undefined) props.push(`background-color: ${rgba(paint.background)}`);
    if (paint.radius !== undefined) props.push(`border-radius: ${paint.radius}px`);
    if (paint.color !== undefined) props.push(`color: ${rgba(paint.color)}`);
    if (paint.fontSize !== undefined) props.push(`font-size: ${paint.fontSize}px`);
    if (paint.fontWeight !== undefined) props.push(`font-weight: ${paint.fontWeight === 700 ? 700 : 400}`);
    if (props.length === 0) return;
    this.emit(`gtk_widget_set_name(${v}, "${v}");`);
    this.css.push(`#${v} { ${props.join('; ')}; }`);
  }

  // Places `node` (already created as `v`) in `holder`, with its alignment, size and growth.
  attach(node: LayoutNode, v: string, parent: LayoutNode, holder: string, first: boolean): void {
    const cross = parent.horizontal ? 'valign' : 'halign';
    const main = parent.horizontal ? 'h' : 'v';
    const crossAlign = parent.align === 'stretch' && node.stretchInset === undefined ? 'start' : parent.align;
    this.emit(`gtk_widget_set_${cross}(${v}, ${ALIGN_NAME[crossAlign]});`);
    if (node.width !== undefined || node.height !== undefined) {
      this.emit(`gtk_widget_set_size_request(${v}, ${node.width ?? -1}, ${node.height ?? -1});`);
    }
    if (node.grow) this.emit(`gtk_widget_set_${main}expand(${v}, TRUE);`);
    // With space-between the box has no spacing (spacers sit between children), so the gap is a margin.
    if (parent.justify === 'space-between' && !first && parent.gap > 0) {
      this.emit(`gtk_widget_set_margin_${parent.horizontal ? 'start' : 'top'}(${v}, ${parent.gap});`);
    }
    this.emit(`gtk_box_append(GTK_BOX(${holder}), ${v});`);
  }

  box(node: LayoutNode, parent: LayoutNode | undefined, holder: string | undefined, first: boolean): void {
    const v = `w_${node.id}`;
    const orientation = node.horizontal ? 'GTK_ORIENTATION_HORIZONTAL' : 'GTK_ORIENTATION_VERTICAL';
    const betweenSpacers = node.justify === 'space-between' && node.children.length > 1;
    this.emit(`GtkWidget* ${v} = gtk_box_new(${orientation}, ${node.justify === 'space-between' ? 0 : node.gap});`);
    this.style(node, v);
    if (parent === undefined) this.emit(`gtk_window_set_child(GTK_WINDOW(window), ${v});`);
    else this.attach(node, v, parent, holder!, first);
    // center and end sit in an inner box that takes the free space and aligns its content.
    let children = v;
    if (node.justify === 'center' || node.justify === 'end') {
      children = `inner_${node.id}`;
      const main = node.horizontal ? 'h' : 'v';
      this.emit(
        `GtkWidget* ${children} = gtk_box_new(${orientation}, ${node.gap});`,
        `gtk_widget_set_${main}align(${children}, ${ALIGN_NAME[node.justify]});`,
        `gtk_widget_set_${main}expand(${children}, TRUE);`,
        `gtk_box_append(GTK_BOX(${v}), ${children});`,
      );
    }
    node.children.forEach((child, index) => {
      if (betweenSpacers && index > 0) {
        const spacer = `spacer_${node.id}_${index - 1}`;
        this.emit(
          '',
          `GtkWidget* ${spacer} = gtk_box_new(${orientation}, 0);`,
          `gtk_widget_set_${node.horizontal ? 'h' : 'v'}expand(${spacer}, TRUE);`,
          `gtk_box_append(GTK_BOX(${v}), ${spacer});`,
        );
      }
      this.emit('');
      this.node(child, node, children, index === 0);
    });
  }

  text(node: LayoutNode, parent: LayoutNode, holder: string, first: boolean): void {
    const v = `w_${node.id}`;
    const bound = this.i18n && node.content !== undefined && node.content.kind !== 'literal';
    this.emit(`GtkWidget* ${v} = gtk_label_new(${cppString(bound ? '' : this.textOf(node))});`);
    const xalign = { right: '1.0f', center: '0.5f' }[node.paint.textAlign ?? ''] ?? '0.0f';
    this.emit(`gtk_label_set_xalign(GTK_LABEL(${v}), ${xalign});`);
    this.style(node, v);
    if (!this.bindContent(node, v, false) && node.content?.kind === 'state') this.emit(`g_surface.bind(StateId::${node.content.state}, ${v}, false);`);
    this.attach(node, v, parent, holder, first);
  }

  button(node: LayoutNode, parent: LayoutNode, holder: string, first: boolean): void {
    const v = `w_${node.id}`;
    const tag = this.handlers.length;
    this.handlers.push(node.handler);
    const bound = this.i18n && node.content !== undefined && node.content.kind !== 'literal';
    this.emit(`GtkWidget* ${v} = gtk_button_new_with_label(${cppString(bound ? '' : this.textOf(node))});`);
    this.style(node, v);
    if (!this.bindContent(node, v, true) && node.content?.kind === 'state') this.emit(`g_surface.bind(StateId::${node.content.state}, ${v}, true);`);
    this.emit(`g_signal_connect(${v}, "clicked", G_CALLBACK(on_click), GINT_TO_POINTER(${tag}));`);
    this.attach(node, v, parent, holder, first);
  }

  // <select language>: a dropdown of English plus one item per pack; refresh_all() fills and selects it.
  select(node: LayoutNode, parent: LayoutNode, holder: string, first: boolean): void {
    const v = `w_${node.id}`;
    this.emit(`GtkWidget* ${v} = gtk_drop_down_new(nullptr, nullptr);`);
    this.style(node, v);
    for (const [value, name] of node.languages ?? []) this.emit(`g_surface.add_language(${v}, ${cppString(value)}, Text(${cppString(name)}));`);
    this.emit(`g_signal_connect(${v}, "notify::selected", G_CALLBACK(on_language_selected), nullptr);`);
    this.attach(node, v, parent, holder, first);
  }

  node(node: LayoutNode, parent: LayoutNode | undefined, holder: string | undefined, first: boolean): void {
    if (node.kind === 'select' && parent) this.select(node, parent, holder!, first);
    else if (node.kind === 'text' && parent) this.text(node, parent, holder!, first);
    else if (node.kind === 'button' && parent) this.button(node, parent, holder!, first);
    else this.box(node, parent, holder, first);
  }
}

// The surface of apps with language packs: texts are Text values rendered again whenever the language changes.
const I18N_SURFACE = `enum class Kind { Label, Button, Window };

class GtkSurface : public Surface {
 public:
  // A widget or window whose text is a fixed message, or follows a state.
  void bind_text(Kind kind, GtkWidget* object, const Text& text) { bound_.push_back({kind, object, -1, text}); }
  void bind_state(Kind kind, GtkWidget* object, StateId state) { bound_.push_back({kind, object, static_cast<int>(state), Text()}); }
  // A choice of a language dropdown (its model is created with the first choice).
  void add_language(GtkWidget* dropdown, const char* value, const Text& name) {
    for (Dropdown& known : dropdowns_) {
      if (known.widget != dropdown) continue;
      known.choices.push_back({value, name});
      return;
    }
    GtkStringList* list = gtk_string_list_new(nullptr);
    gtk_drop_down_set_model(GTK_DROP_DOWN(dropdown), G_LIST_MODEL(list));
    g_object_unref(list);  // the dropdown keeps it
    dropdowns_.push_back({dropdown, list, {{value, name}}, {}});
  }
  std::string language_at(GtkWidget* dropdown, guint index) const {
    for (const Dropdown& known : dropdowns_)
      if (known.widget == dropdown && index < known.choices.size()) return known.choices[index].value;
    return "";
  }
  // True while refresh_all() changes widgets: their change signals must not choose a language again.
  bool refreshing() const { return refreshing_ > 0; }

  void set_state(StateId id, const Text& text) override {
    const std::size_t index = static_cast<std::size_t>(id);
    if (states_.size() <= index) states_.resize(index + 1);
    states_[index] = text;
    refresh_all();
  }

  // Renders every text again: after the window is built, when a state changes and when the language changes.
  void refresh_all() {
    ++refreshing_;
    for (const Bound& bound : bound_) {
      const std::size_t state = static_cast<std::size_t>(bound.state);
      const Text& text = bound.state < 0 ? bound.text : (state < states_.size() ? states_[state] : empty_);
      const std::string value = render(text);
      switch (bound.kind) {
        case Kind::Label: gtk_label_set_text(GTK_LABEL(bound.object), value.c_str()); break;
        case Kind::Button: gtk_button_set_label(GTK_BUTTON(bound.object), value.c_str()); break;
        case Kind::Window: gtk_window_set_title(GTK_WINDOW(bound.object), value.c_str()); break;
      }
    }
    const std::string active = active_language();
    for (Dropdown& dropdown : dropdowns_) {
      std::vector<std::string> names;
      for (const Choice& choice : dropdown.choices) {
        std::string name = render(choice.name);
        if (language_offline(choice.value)) name += render(Text::tr(" (offline)"));
        names.push_back(name);
      }
      if (names != dropdown.shown) {
        std::vector<const char*> items;
        for (const std::string& name : names) items.push_back(name.c_str());
        items.push_back(nullptr);
        gtk_string_list_splice(dropdown.list, 0, static_cast<guint>(dropdown.shown.size()), items.data());
        dropdown.shown = names;
      }
      for (std::size_t i = 0; i < dropdown.choices.size(); ++i)
        if (dropdown.choices[i].value == active) gtk_drop_down_set_selected(GTK_DROP_DOWN(dropdown.widget), static_cast<guint>(i));
    }
    --refreshing_;
  }

 private:
  struct Bound {
    Kind kind;
    GtkWidget* object;
    int state;
    Text text;
  };
  struct Choice {
    std::string value;
    Text name;
  };
  struct Dropdown {
    GtkWidget* widget;
    GtkStringList* list;
    std::vector<Choice> choices;
    std::vector<std::string> shown;
  };
  std::vector<Bound> bound_;
  std::vector<Dropdown> dropdowns_;
  std::vector<Text> states_;
  Text empty_;
  int refreshing_ = 0;
};
`;

const PLAIN_SURFACE = `class GtkSurface : public Surface {
 public:
  void bind(StateId id, GtkWidget* widget, bool is_button) { bindings_.push_back({id, widget, is_button}); }

  void set_state(StateId id, const char* text) override {
    for (const Binding& binding : bindings_) {
      if (binding.id != id) continue;
      if (binding.is_button) {
        gtk_button_set_label(GTK_BUTTON(binding.widget), text);
      } else {
        gtk_label_set_text(GTK_LABEL(binding.widget), text);
      }
    }
  }

 private:
  struct Binding {
    StateId id;
    GtkWidget* widget;
    bool is_button;
  };
  std::vector<Binding> bindings_;
};
`;

// A change of the dropdown choice: an offline language goes back to the active one, the others are chosen.
const LANGUAGE_SELECTED = `
void on_language_selected(GObject* object, GParamSpec*, gpointer) {
  if (g_surface.refreshing()) return;
  const std::string value = g_surface.language_at(GTK_WIDGET(object), gtk_drop_down_get_selected(GTK_DROP_DOWN(object)));
  if (value.empty()) return;
  if (language_offline(value)) {
    g_surface.refresh_all();
    return;
  }
  choose_language(value);
}
`;

export function generateLinuxUi(ir: Ir, appId: string, i18n?: I18nGenOptions): string {
  const { root } = ir;
  if (hasSelect(root) && (!i18n || i18n.packs.length === 0)) throw new Error('<select language> needs at least one language pack');
  const translated = i18n !== undefined && i18n.packs.length > 0;
  const layout = layoutOf(root, languageChoices(i18n));
  const width = layout.width ?? DEFAULT_WIDTH;
  const height = layout.height ?? DEFAULT_HEIGHT;
  const emitter = new Emitter(ir, translated);
  emitter.node(layout, undefined, undefined, true);
  const cases = emitter.handlers
    .map((handler, tag) => (handler === undefined ? '' : `    case ${tag}:\n      action_${handler}(g_surface);\n      break;\n`))
    .join('');
  const title = root.title;
  const windowTitle =
    translated && title !== undefined && title.kind !== 'literal'
      ? `g_surface.bind_text(Kind::Window, window, ${textExpr(ir, title)});`
      : `gtk_window_set_title(GTK_WINDOW(window), ${cppString(title ? textOf(title) : ir.app.name)});`;
  const initialStates = translated ? ir.states.map((state) => `  g_surface.set_state(StateId::${state.id}, ${textExpr(ir, state.initial)});\n`).join('') : '';
  const css = emitter.css.length === 0 ? '' : `
  static const char* const css = R"css(
${emitter.css.join('\n')}
)css";
  GtkCssProvider* provider = gtk_css_provider_new();
#if GTK_CHECK_VERSION(4, 12, 0)
  gtk_css_provider_load_from_string(provider, css);
#else
  gtk_css_provider_load_from_data(provider, css, -1);
#endif
  gtk_style_context_add_provider_for_display(gdk_display_get_default(), GTK_STYLE_PROVIDER(provider),
                                             GTK_STYLE_PROVIDER_PRIORITY_APPLICATION);
  g_object_unref(provider);
`;
  return `// Generated by forge. Do not edit.
#include <gtk/gtk.h>

${translated ? '#include <string>\n' : ''}#include <vector>

#include "forge_app.hpp"

using namespace forge_app;

namespace {

${translated ? I18N_SURFACE : PLAIN_SURFACE}
GtkSurface g_surface;

void on_click(GtkButton*, gpointer data) {
  switch (GPOINTER_TO_INT(data)) {
${cases}  }
}
${translated && hasSelect(root) ? LANGUAGE_SELECTED : ''}
void on_quit(GSimpleAction*, GVariant*, gpointer app) { g_application_quit(G_APPLICATION(app)); }

void activate(GtkApplication* app, gpointer) {
  GSimpleAction* quit = g_simple_action_new("quit", nullptr);
  g_signal_connect(quit, "activate", G_CALLBACK(on_quit), app);
  g_action_map_add_action(G_ACTION_MAP(app), G_ACTION(quit));
  g_object_unref(quit);
  static const char* const quit_accels[] = {"<Control>q", nullptr};
  gtk_application_set_accels_for_action(app, "app.quit", quit_accels);
${css}
  GtkWidget* window = gtk_application_window_new(app);
  ${windowTitle}
  gtk_window_set_default_size(GTK_WINDOW(window), ${width}, ${height});
  gtk_widget_set_size_request(window, ${width}, ${height});

${emitter.lines.join('\n')}
${translated ? '\n  g_surface.refresh_all();' : ''}
  gtk_window_present(GTK_WINDOW(window));
}

}  // namespace

int forge_app::run_ui(int argc, char** argv) {
  (void)argc;
${translated ? `  // A cached language pack is applied before the window exists, so there is no flash of English.
  set_refresh_hook([] { g_surface.refresh_all(); });
  start_gui_language();
${initialStates}` : ''}  GtkApplication* app = gtk_application_new(${cppString(appId)}, G_APPLICATION_DEFAULT_FLAGS);
  g_signal_connect(app, "activate", G_CALLBACK(activate), nullptr);
  // The command line was already handled by forge: GTK gets only the program name.
  const int status = g_application_run(G_APPLICATION(app), 1, argv);
  g_object_unref(app);
  return status;
}
`;
}
