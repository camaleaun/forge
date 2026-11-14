#pragma once

#include <cstdio>

#include "forge_app.hpp"

namespace forge_app {

// In CLI mode there is no window: setting a state prints its text.
class CliSurface : public Surface {
 public:
  void set_state(StateId, const char* text) override { std::puts(text); }
};

}  // namespace forge_app
