#pragma once

#include <cstdio>

#include "forge_app.hpp"

namespace forge_app {

// In CLI mode there is no window: setting a state prints its text.
class CliSurface : public Surface {
 public:
#ifdef FORGE_I18N
  void set_state(StateId, const Text& text) override { std::puts(render(text).c_str()); }
#else
  void set_state(StateId, const char* text) override { std::puts(text); }
#endif
};

}  // namespace forge_app
