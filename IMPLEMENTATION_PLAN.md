# Basketball Simulator Game - Implementation Plan

## Project Overview

A comprehensive basketball simulation game featuring deep franchise management, tactical coaching systems, and visual game simulation. Built with Laravel (backend API) and Vue 3 (frontend PWA) for cross-platform deployment.

---

## Tech Stack

| Layer                | Technology                  | Purpose                                                            |
| -------------------- | --------------------------- | ------------------------------------------------------------------ |
| **Backend**          | Laravel 11                  | REST API, authentication, data persistence, multiplayer validation |
| **Auth**             | Laravel Sanctum + Socialite | Token auth for SPA, OAuth for social logins                        |
| **Frontend**         | Vue 3 + Vite                | SPA, game simulation engine, PWA                                   |
| **State Management** | Pinia                       | Complex game state management                                      |
| **Validation**       | Vuelidate                   | Frontend form validation (Composition API)                         |
| **Database**         | MySQL                       | Relational data storage                                            |
| **Visualization**    | HTML5 Canvas                | 2D court rendering                                                 |
| **Mobile**           | PWA (Workbox)               | Installable, offline-capable web app                               |
| **Typography**       | Bebas Neue + Inter          | Display headers + body text (Google Fonts)                         |
| **Icons**            | Heroicons                   | Consistent icon system                                             |

---

## Design System

> **Style**: Retro-Vaporwave meets Modern Glassmorphism
> Athletic typography + frosted glass components + dreamy gradients on a dark charcoal base

### Design Philosophy

The visual identity blends **vaporwave aesthetics** (soft gradients, dreamy color transitions) with **modern glassmorphism** (frosted translucent surfaces, depth through layering) and **sports display typography** (bold, condensed, athletic). The result is a unique look that feels both nostalgic and premium.

---

### Color Palette

> **📝 EDIT THIS SECTION** to customize your colors. Update the hex values below and they'll propagate through the CSS variables.

#### Base Colors (Dark Theme Foundation)

```css
:root {
  /* ═══════════════════════════════════════════════════════════
     BACKGROUND COLORS - Dark charcoal base
     ═══════════════════════════════════════════════════════════ */
  --color-bg-primary: #121214; /* Main app background */
  --color-bg-secondary: #1a1a1f; /* Card/container backgrounds */
  --color-bg-tertiary: #242429; /* Elevated surfaces, hover states */
  --color-bg-elevated: #2d2d35; /* Modals, dropdowns, tooltips */
  --color-bg-primary: #23242f; /* Deep Slate Blue - softer than black */
  --color-bg-secondary: #2e303e; /* Card/container backgrounds */
  --color-bg-tertiary: #393c4d; /* Elevated surfaces, hover states */
  --color-bg-elevated: #45495e; /* Modals, dropdowns, tooltips */

  /* ═══════════════════════════════════════════════════════════
     ACCENT COLORS - Vaporwave palette (CUSTOMIZE THESE!)
     ═══════════════════════════════════════════════════════════ */
  --color-primary: #7c3aed; /* Primary actions, links */
  --color-primary: #8b5cf6; /* Violet - Sleek & Retro */
  --color-primary-light: #a78bfa; /* Primary hover/focus states */
  --color-primary-dark: #5b21b6; /* Primary pressed states */
  --color-primary-dark: #7c3aed; /* Primary pressed states */

  --color-secondary: #ec4899; /* Secondary accent (pink) */
  --color-secondary-light: #f472b6; /* Secondary hover */
  --color-secondary-dark: #be185d; /* Secondary pressed */
  --color-secondary: #f43f5e; /* Retro Rose/Coral */
  --color-secondary-light: #fb7185; /* Secondary hover */
  --color-secondary-dark: #e11d48; /* Secondary pressed */

  --color-tertiary: #06b6d4; /* Tertiary accent (cyan) */
  --color-tertiary-light: #22d3ee; /* Tertiary hover */
  --color-tertiary-dark: #0891b2; /* Tertiary pressed */
  --color-tertiary: #0ea5e9; /* Sky Blue */
  --color-tertiary-light: #38bdf8; /* Tertiary hover */
  --color-tertiary-dark: #0284c7; /* Tertiary pressed */

  /* ═══════════════════════════════════════════════════════════
     GRADIENT DEFINITIONS - Signature vaporwave gradients
     ═══════════════════════════════════════════════════════════ */
  --gradient-primary: linear-gradient(135deg, #7c3aed 0%, #ec4899 100%);
  --gradient-secondary: linear-gradient(135deg, #ec4899 0%, #06b6d4 100%);
  --gradient-primary: linear-gradient(135deg, #8b5cf6 0%, #f43f5e 100%);
  --gradient-secondary: linear-gradient(135deg, #f43f5e 0%, #0ea5e9 100%);
  --gradient-sunset: linear-gradient(
    180deg,
    #7c3aed 0%,
    #ec4899 50%,
    #8b5cf6 0%,
    #f43f5e 50%,
    #f97316 100%
  );
  --gradient-ocean: linear-gradient(135deg, #06b6d4 0%, #7c3aed 100%);
  --gradient-ocean: linear-gradient(135deg, #0ea5e9 0%, #8b5cf6 100%);
  --gradient-subtle: linear-gradient(
    135deg,
    rgba(124, 58, 237, 0.1) 0%,
    rgba(236, 72, 153, 0.1) 100% rgba(139, 92, 246, 0.1) 0%,
    rgba(244, 63, 94, 0.1) 100%
  );

  /* ═══════════════════════════════════════════════════════════
     TEXT COLORS
     ═══════════════════════════════════════════════════════════ */
  --color-text-primary: #f4f4f5; /* Main text */
  --color-text-secondary: #a1a1aa; /* Subdued text, labels */
  --color-text-tertiary: #71717a; /* Placeholder, disabled */
  --color-text-inverse: #121214; /* Text on light backgrounds */

  /* ═══════════════════════════════════════════════════════════
     SEMANTIC COLORS - Status indicators
     ═══════════════════════════════════════════════════════════ */
  --color-success: #10b981; /* Win, positive stats */
  --color-success-light: #34d399;
  --color-warning: #f59e0b; /* Caution, pending */
  --color-warning-light: #fbbf24;
  --color-error: #ef4444; /* Loss, negative stats */
  --color-error-light: #f87171;
  --color-info: #3b82f6; /* Informational */
  --color-info-light: #60a5fa;

  /* ═══════════════════════════════════════════════════════════
     GLASSMORPHISM - Frosted glass effects
     ═══════════════════════════════════════════════════════════ */
  --glass-bg: rgba(26, 26, 31, 0.7);
  --glass-bg-light: rgba(36, 36, 41, 0.6);
  --glass-border: rgba(255, 255, 255, 0.1);
  --glass-border-focus: rgba(124, 58, 237, 0.5);
  --glass-blur: 12px;
  --glass-blur-heavy: 20px;

  /* ═══════════════════════════════════════════════════════════
     SHADOWS & GLOWS
     ═══════════════════════════════════════════════════════════ */
  --shadow-sm: 0 1px 2px rgba(0, 0, 0, 0.3);
  --shadow-md: 0 4px 6px rgba(0, 0, 0, 0.4);
  --shadow-lg: 0 10px 15px rgba(0, 0, 0, 0.5);
  --shadow-xl: 0 20px 25px rgba(0, 0, 0, 0.6);
  --glow-primary: 0 0 20px rgba(124, 58, 237, 0.4);
  --glow-secondary: 0 0 20px rgba(236, 72, 153, 0.4);
  --glow-tertiary: 0 0 20px rgba(6, 182, 212, 0.4);
  --glow-primary: 0 0 20px rgba(139, 92, 246, 0.4);
  --glow-secondary: 0 0 20px rgba(244, 63, 94, 0.4);
  --glow-tertiary: 0 0 20px rgba(14, 165, 233, 0.4);
}
```

#### Color Usage Guidelines

| Context               | Color Variable      | Example Use                                  |
| --------------------- | ------------------- | -------------------------------------------- |
| **Primary Actions**   | `--color-primary`   | Main CTA buttons, active nav items           |
| **Secondary Actions** | `--color-secondary` | Secondary buttons, highlights                |
| **Links/Interactive** | `--color-tertiary`  | Text links, interactive elements             |
| **Win/Positive**      | `--color-success`   | Win records, positive stat changes           |
| **Loss/Negative**     | `--color-error`     | Loss records, negative stat changes          |
| **Backgrounds**       | `--color-bg-*`      | Use hierarchy for depth (primary → elevated) |
| **Glass Surfaces**    | `--glass-*`         | Cards, modals, overlays                      |

---

### Typography

#### Font Stack

```css
:root {
  /* Display/Headers - Athletic condensed font */
  --font-display: "Bebas Neue", "Anton", "Impact", sans-serif;

  /* Body/UI - Clean, readable sans-serif */
  --font-body: "Inter", "SF Pro Display", -apple-system, BlinkMacSystemFont, sans-serif;

  /* Monospace - Stats, numbers, code */
  --font-mono: "JetBrains Mono", "Fira Code", "Consolas", monospace;
}
```

#### Type Scale

```css
:root {
  /* Font Sizes */
  --text-xs: 0.75rem; /* 12px - Fine print, badges */
  --text-sm: 0.875rem; /* 14px - Secondary text, labels */
  --text-base: 1rem; /* 16px - Body text */
  --text-lg: 1.125rem; /* 18px - Large body */
  --text-xl: 1.25rem; /* 20px - Section headers */
  --text-2xl: 1.5rem; /* 24px - Card titles */
  --text-3xl: 1.875rem; /* 30px - Page subtitles */
  --text-4xl: 2.25rem; /* 36px - Page titles */
  --text-5xl: 3rem; /* 48px - Hero headers */
  --text-6xl: 3.75rem; /* 60px - Large display */
  --text-7xl: 4.5rem; /* 72px - Scoreboard numbers */

  /* Font Weights */
  --font-normal: 400;
  --font-medium: 500;
  --font-semibold: 600;
  --font-bold: 700;
  --font-black: 900;

  /* Line Heights */
  --leading-tight: 1.1; /* Headers */
  --leading-snug: 1.25; /* Subheaders */
  --leading-normal: 1.5; /* Body text */
  --leading-relaxed: 1.75; /* Long-form content */

  /* Letter Spacing */
  --tracking-tighter: -0.05em; /* Large display text */
  --tracking-tight: -0.025em; /* Headers */
  --tracking-normal: 0; /* Body */
  --tracking-wide: 0.025em; /* Small caps, labels */
  --tracking-wider: 0.05em; /* Buttons, badges */
  --tracking-widest: 0.1em; /* All-caps labels */
}
```

#### Typography Classes

```css
/* Display Headers - Athletic style */
.text-display {
  font-family: var(--font-display);
  font-weight: var(--font-black);
  line-height: var(--leading-tight);
  letter-spacing: var(--tracking-wide);
  text-transform: uppercase;
}

/* Body Text */
.text-body {
  font-family: var(--font-body);
  font-weight: var(--font-normal);
  line-height: var(--leading-normal);
}

/* Stats/Numbers - Monospace for alignment */
.text-stat {
  font-family: var(--font-mono);
  font-weight: var(--font-semibold);
  font-variant-numeric: tabular-nums;
}

/* Gradient Text Effect */
.text-gradient {
  background: var(--gradient-primary);
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
  background-clip: text;
}
```

---

### Spacing System

```css
:root {
  /* Spacing Scale (4px base) */
  --space-0: 0;
  --space-1: 0.25rem; /* 4px */
  --space-2: 0.5rem; /* 8px */
  --space-3: 0.75rem; /* 12px */
  --space-4: 1rem; /* 16px */
  --space-5: 1.25rem; /* 20px */
  --space-6: 1.5rem; /* 24px */
  --space-8: 2rem; /* 32px */
  --space-10: 2.5rem; /* 40px */
  --space-12: 3rem; /* 48px */
  --space-16: 4rem; /* 64px */
  --space-20: 5rem; /* 80px */
  --space-24: 6rem; /* 96px */

  /* Border Radius */
  --radius-sm: 0.25rem; /* 4px - Subtle rounding */
  --radius-md: 0.5rem; /* 8px - Buttons, inputs */
  --radius-lg: 0.75rem; /* 12px - Cards */
  --radius-xl: 1rem; /* 16px - Large cards */
  --radius-2xl: 1.5rem; /* 24px - Modals */
  --radius-full: 9999px; /* Pills, avatars */
}
```

---

### Component Styles

#### Glass Card (Primary Container)

```css
.glass-card {
  background: var(--glass-bg);
  backdrop-filter: blur(var(--glass-blur));
  -webkit-backdrop-filter: blur(var(--glass-blur));
  border: 1px solid var(--glass-border);
  border-radius: var(--radius-lg);
  box-shadow: var(--shadow-lg);
}

.glass-card:hover {
  border-color: var(--glass-border-focus);
  box-shadow: var(--shadow-xl), var(--glow-primary);
}

/* Elevated glass for modals/dropdowns */
.glass-card-elevated {
  background: var(--glass-bg-light);
  backdrop-filter: blur(var(--glass-blur-heavy));
  border: 1px solid var(--glass-border);
  border-radius: var(--radius-xl);
  box-shadow: var(--shadow-xl);
}
```

#### Buttons

```css
/* Primary Button - Gradient with glow */
.btn-primary {
  background: var(--gradient-primary);
  color: var(--color-text-primary);
  font-family: var(--font-display);
  font-size: var(--text-sm);
  font-weight: var(--font-bold);
  letter-spacing: var(--tracking-wider);
  text-transform: uppercase;
  padding: var(--space-3) var(--space-6);
  border: none;
  border-radius: var(--radius-md);
  box-shadow: var(--shadow-md);
  transition: all 0.2s ease;
}

.btn-primary:hover {
  transform: translateY(-2px);
  box-shadow: var(--shadow-lg), var(--glow-primary);
}

.btn-primary:active {
  transform: translateY(0);
}

/* Secondary Button - Glass style */
.btn-secondary {
  background: var(--glass-bg);
  backdrop-filter: blur(var(--glass-blur));
  color: var(--color-text-primary);
  border: 1px solid var(--glass-border);
  /* ... same font styles as primary */
}

.btn-secondary:hover {
  border-color: var(--color-primary);
  box-shadow: var(--glow-primary);
}

/* Ghost Button - Text only */
.btn-ghost {
  background: transparent;
  color: var(--color-primary-light);
  border: none;
}

.btn-ghost:hover {
  background: rgba(124, 58, 237, 0.1);
}
```

#### Form Inputs

```css
.input {
  background: var(--glass-bg);
  backdrop-filter: blur(var(--glass-blur));
  border: 1px solid var(--glass-border);
  border-radius: var(--radius-md);
  color: var(--color-text-primary);
  font-family: var(--font-body);
  font-size: var(--text-base);
  padding: var(--space-3) var(--space-4);
  transition: all 0.2s ease;
}

.input:focus {
  outline: none;
  border-color: var(--color-primary);
  box-shadow: var(--glow-primary);
}

.input::placeholder {
  color: var(--color-text-tertiary);
}

/* Validation States */
.input.is-invalid {
  border-color: var(--color-error);
  box-shadow: 0 0 0 1px var(--color-error);
}

.input.is-valid {
  border-color: var(--color-success);
}

.input-error {
  color: var(--color-error);
  font-size: var(--text-sm);
  margin-top: var(--space-1);
}
```

#### Form Validation (Vuelidate)

**Installation:**

```bash
npm install @vuelidate/core @vuelidate/validators
```

**Basic Usage Pattern:**

```vue
<script setup>
import { useVuelidate } from "@vuelidate/core";
import { required, email, minLength, helpers } from "@vuelidate/validators";
import { reactive, computed } from "vue";

const state = reactive({
  email: "",
  password: "",
  username: "",
});

const rules = computed(() => ({
  email: {
    required: helpers.withMessage("Email is required", required),
    email: helpers.withMessage("Please enter a valid email", email),
  },
  password: {
    required: helpers.withMessage("Password is required", required),
    minLength: helpers.withMessage(
      "Password must be at least 8 characters",
      minLength(8),
    ),
  },
  username: {
    required: helpers.withMessage("Username is required", required),
    minLength: helpers.withMessage(
      "Username must be at least 3 characters",
      minLength(3),
    ),
  },
}));

const v$ = useVuelidate(rules, state);

const onSubmit = async () => {
  const isValid = await v$.value.$validate();
  if (!isValid) return;
  // Submit form...
};
</script>

<template>
  <form @submit.prevent="onSubmit">
    <div class="form-group">
      <label for="email">Email</label>
      <input
        id="email"
        v-model="state.email"
        type="email"
        class="input"
        :class="{ 'is-invalid': v$.email.$error }"
        @blur="v$.email.$touch()"
      />
      <p v-if="v$.email.$error" class="input-error">
        {{ v$.email.$errors[0].$message }}
      </p>
    </div>
    <!-- ... more fields -->
  </form>
</template>
```

**Custom Validators (Game-Specific):**

```javascript
// validators/gameValidators.js
import { helpers } from "@vuelidate/validators";

// Player rating must be 0-99
export const validRating = helpers.withMessage(
  "Rating must be between 0 and 99",
  (value) => value >= 0 && value <= 99,
);

// Jersey number 0-99
export const validJerseyNumber = helpers.withMessage(
  "Jersey number must be between 0 and 99",
  (value) => value >= 0 && value <= 99,
);

// Salary within cap space
export const withinCapSpace = (capSpace) =>
  helpers.withMessage(
    `Salary cannot exceed available cap space ($${capSpace.toLocaleString()})`,
    (value) => value <= capSpace,
  );

// Username format (alphanumeric + underscore)
export const validUsername = helpers.withMessage(
  "Username can only contain letters, numbers, and underscores",
  helpers.regex(/^[a-zA-Z0-9_]+$/),
);
```

**Reusable Form Input Component:**

```vue
<!-- components/ui/FormInput.vue -->
<script setup>
const props = defineProps({
  modelValue: {
    type: [String, Number],
    required: true,
  },
  label: {
    type: String,
    required: true,
  },
  type: {
    type: String,
    default: "text",
  },
  placeholder: {
    type: String,
    default: "",
  },
  error: {
    type: String,
    default: "",
  },
  touched: {
    type: Boolean,
    default: false,
  },
});

const emit = defineEmits(["update:modelValue", "blur"]);
</script>

<template>
  <div class="form-group">
    <label class="form-label">{{ label }}</label>
    <input
      :type="type"
      :value="modelValue"
      :placeholder="placeholder"
      class="input"
      :class="{ 'is-invalid': touched && error }"
      @input="emit('update:modelValue', $event.target.value)"
      @blur="emit('blur')"
    />
    <p v-if="touched && error" class="input-error">{{ error }}</p>
  </div>
</template>
```

**Forms Requiring Validation:**
| Form | Fields | Special Validators |
|------|--------|-------------------|
| **Registration** | email, password, username | `email`, `minLength`, `validUsername` |
| **Login** | email, password | `required`, `email` |
| **Profile Edit** | username, avatar | `validUsername` |
| **Contract Offer** | years, salary | `withinCapSpace`, number ranges |
| **Trade Proposal** | players, picks | Salary matching validation |
| **Campaign Create** | name, team selection | `required`, `minLength` |

---

#### Stats Display

```css
/* Player stat rating (0-99) */
.stat-badge {
  font-family: var(--font-mono);
  font-size: var(--text-sm);
  font-weight: var(--font-bold);
  padding: var(--space-1) var(--space-2);
  border-radius: var(--radius-sm);
  min-width: 2.5rem;
  text-align: center;
}

/* Color coding for stat values */
.stat-elite {
  background: var(--color-success);
} /* 90-99 */
.stat-great {
  background: var(--color-tertiary);
} /* 80-89 */
.stat-good {
  background: var(--color-primary);
} /* 70-79 */
.stat-average {
  background: var(--color-warning);
} /* 60-69 */
.stat-below {
  background: var(--color-error);
} /* Below 60 */
```

#### Badge Components (Player Badges)

```css
.badge {
  display: inline-flex;
  align-items: center;
  gap: var(--space-1);
  padding: var(--space-1) var(--space-2);
  border-radius: var(--radius-full);
  font-family: var(--font-body);
  font-size: var(--text-xs);
  font-weight: var(--font-semibold);
  text-transform: uppercase;
  letter-spacing: var(--tracking-wide);
}

.badge-bronze {
  background: linear-gradient(135deg, #cd7f32 0%, #8b4513 100%);
}
.badge-silver {
  background: linear-gradient(135deg, #c0c0c0 0%, #808080 100%);
}
.badge-gold {
  background: linear-gradient(135deg, #ffd700 0%, #daa520 100%);
  color: var(--color-text-inverse);
}
.badge-hof {
  background: var(--gradient-primary);
  box-shadow: var(--glow-primary);
}
```

---

### Animations

#### Timing & Easing

```css
:root {
  /* Durations */
  --duration-fast: 150ms;
  --duration-normal: 250ms;
  --duration-slow: 400ms;
  --duration-slower: 600ms;

  /* Easing Functions */
  --ease-default: cubic-bezier(0.4, 0, 0.2, 1);
  --ease-in: cubic-bezier(0.4, 0, 1, 1);
  --ease-out: cubic-bezier(0, 0, 0.2, 1);
  --ease-bounce: cubic-bezier(0.68, -0.55, 0.265, 1.55);
}
```

#### Standard Transitions

```css
/* Default transition for interactive elements */
.transition-default {
  transition: all var(--duration-normal) var(--ease-default);
}

/* Fast micro-interactions (hover states) */
.transition-fast {
  transition: all var(--duration-fast) var(--ease-default);
}

/* Slower transitions (page/view changes) */
.transition-slow {
  transition: all var(--duration-slow) var(--ease-out);
}
```

#### Keyframe Animations

```css
/* Fade In */
@keyframes fadeIn {
  from {
    opacity: 0;
  }
  to {
    opacity: 1;
  }
}

/* Slide Up (for modals, toasts) */
@keyframes slideUp {
  from {
    opacity: 0;
    transform: translateY(20px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

/* Scale In (for cards, buttons) */
@keyframes scaleIn {
  from {
    opacity: 0;
    transform: scale(0.95);
  }
  to {
    opacity: 1;
    transform: scale(1);
  }
}

/* Glow Pulse (for active/live elements) */
@keyframes glowPulse {
  0%,
  100% {
    box-shadow: var(--glow-primary);
  }
  50% {
    box-shadow: 0 0 30px rgba(124, 58, 237, 0.6);
  }
}

/* Score Update Flash */
@keyframes scoreFlash {
  0% {
    color: var(--color-text-primary);
  }
  50% {
    color: var(--color-success);
    transform: scale(1.1);
  }
  100% {
    color: var(--color-text-primary);
    transform: scale(1);
  }
}

/* Utility Classes */
.animate-fade-in {
  animation: fadeIn var(--duration-normal) var(--ease-out);
}
.animate-slide-up {
  animation: slideUp var(--duration-slow) var(--ease-out);
}
.animate-scale-in {
  animation: scaleIn var(--duration-normal) var(--ease-bounce);
}
.animate-glow {
  animation: glowPulse 2s infinite;
}
```

---

### Layout Patterns

#### Container Widths

```css
:root {
  --container-sm: 640px;
  --container-md: 768px;
  --container-lg: 1024px;
  --container-xl: 1280px;
  --container-2xl: 1536px;
}

.container {
  width: 100%;
  max-width: var(--container-xl);
  margin: 0 auto;
  padding: 0 var(--space-4);
}
```

#### Grid System

```css
/* Standard card grid */
.grid-cards {
  display: grid;
  gap: var(--space-4);
  grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
}

/* Stats table grid */
.grid-stats {
  display: grid;
  gap: var(--space-2);
  grid-template-columns: repeat(auto-fill, minmax(100px, 1fr));
}

/* Player card layout */
.grid-roster {
  display: grid;
  gap: var(--space-4);
  grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
}
```

---

### Responsive Breakpoints

```css
:root {
  --breakpoint-sm: 640px;
  --breakpoint-md: 768px;
  --breakpoint-lg: 1024px;
  --breakpoint-xl: 1280px;
  --breakpoint-2xl: 1536px;
}

/* Mobile First Approach */
/* Base styles = mobile */
/* @media (min-width: 640px) = tablet */
/* @media (min-width: 1024px) = desktop */
/* @media (min-width: 1280px) = large desktop */
```

---

### Icon Guidelines

- **Primary Icon Set**: Heroicons (outline style for nav, solid for actions)
- **Sports Icons**: Custom SVG icons for basketball-specific elements
- **Icon Sizes**:
  - `--icon-sm: 16px` - Inline with text
  - `--icon-md: 20px` - Buttons, nav items
  - `--icon-lg: 24px` - Section headers
  - `--icon-xl: 32px` - Feature icons

---

### Theme System (Dark/Light Mode)

The app supports **dark mode** (default) and **light mode** (high contrast). Themes are controlled via a `data-theme` attribute on the `<html>` element.

#### Theme Toggle Implementation

```javascript
// composables/useTheme.js
import { ref, onMounted } from "vue";

export function useTheme() {
  const theme = ref("dark");

  const setTheme = (newTheme) => {
    theme.value = newTheme;
    document.documentElement.setAttribute("data-theme", newTheme);
    localStorage.setItem("theme", newTheme);
  };

  const toggleTheme = () => {
    setTheme(theme.value === "dark" ? "light" : "dark");
  };

  // Initialize from localStorage or system preference
  onMounted(() => {
    const saved = localStorage.getItem("theme");
    if (saved) {
      setTheme(saved);
    } else if (window.matchMedia("(prefers-color-scheme: light)").matches) {
      setTheme("light");
    }
  });

  return { theme, setTheme, toggleTheme };
}
```

#### Light Mode Color Overrides (High Contrast)

```css
/* ═══════════════════════════════════════════════════════════
   LIGHT MODE - High Contrast Theme
   ═══════════════════════════════════════════════════════════ */
[data-theme="light"] {
  /* Background Colors */
  --color-bg-primary: #ffffff;
  --color-bg-secondary: #f8fafc;
  --color-bg-tertiary: #f1f5f9;
  --color-bg-elevated: #ffffff;

  /* Accent Colors - Slightly deeper for contrast on white */
  --color-primary: #6d28d9;
  --color-primary-light: #7c3aed;
  --color-primary-dark: #5b21b6;

  --color-secondary: #db2777;
  --color-secondary-light: #ec4899;
  --color-secondary-dark: #be185d;

  --color-tertiary: #0891b2;
  --color-tertiary-light: #06b6d4;
  --color-tertiary-dark: #0e7490;

  /* Text Colors */
  --color-text-primary: #0f172a;
  --color-text-secondary: #475569;
  --color-text-tertiary: #94a3b8;
  --color-text-inverse: #ffffff;

  /* Glassmorphism - Light mode adaptation */
  --glass-bg: rgba(255, 255, 255, 0.8);
  --glass-bg-light: rgba(248, 250, 252, 0.9);
  --glass-border: rgba(0, 0, 0, 0.1);
  --glass-border-focus: rgba(109, 40, 217, 0.5);

  /* Shadows - More visible on light backgrounds */
  --shadow-sm: 0 1px 2px rgba(0, 0, 0, 0.05);
  --shadow-md: 0 4px 6px rgba(0, 0, 0, 0.07);
  --shadow-lg: 0 10px 15px rgba(0, 0, 0, 0.1);
  --shadow-xl: 0 20px 25px rgba(0, 0, 0, 0.15);

  /* Gradients - Keep vibrant on light */
  --gradient-primary: linear-gradient(135deg, #6d28d9 0%, #db2777 100%);
  --gradient-secondary: linear-gradient(135deg, #db2777 0%, #0891b2 100%);
  --gradient-subtle: linear-gradient(
    135deg,
    rgba(109, 40, 217, 0.05) 0%,
    rgba(219, 39, 119, 0.05) 100%
  );

  /* Glows - Subtler on light mode */
  --glow-primary: 0 0 15px rgba(109, 40, 217, 0.2);
  --glow-secondary: 0 0 15px rgba(219, 39, 119, 0.2);
  --glow-tertiary: 0 0 15px rgba(8, 145, 178, 0.2);
}
```

#### Theme-Aware Component Adjustments

```css
/* Glass cards need different treatment in light mode */
[data-theme="light"] .glass-card {
  background: var(--glass-bg);
  border: 1px solid var(--glass-border);
  box-shadow: var(--shadow-md);
}

/* Stats badges with dark text on light mode */
[data-theme="light"] .stat-badge {
  color: var(--color-text-inverse);
}

/* Inputs with visible borders */
[data-theme="light"] .input {
  border-color: #e2e8f0;
}

[data-theme="light"] .input:focus {
  border-color: var(--color-primary);
  box-shadow: 0 0 0 3px rgba(109, 40, 217, 0.1);
}
```

#### Theme Storage & Persistence

- **localStorage key**: `theme` → `'dark'` | `'light'`
- **System preference**: Respects `prefers-color-scheme` on first visit
- **User preference**: Saved choice overrides system preference
- **Pinia integration**: Store theme in `useAuthStore` for logged-in users

---

### Implementation Files

When implementing, create these files:

```
src/
├── assets/
│   └── styles/
│       ├── _variables.css      # All CSS custom properties
│       ├── _typography.css     # Font imports, type classes
│       ├── _animations.css     # Keyframes and utilities
│       ├── _components.css     # Button, card, input styles
│       └── main.css            # Import all partials
├── components/
│   └── ui/
│       ├── GlassCard.vue
│       ├── Button.vue
│       ├── Input.vue
│       ├── StatBadge.vue
│       └── Badge.vue
```

---

## Core Systems Architecture

### 0. User Management & Authentication

**Authentication Methods:**

- **Email/Password**: Traditional registration with email verification
- **Social OAuth**: Google, Apple, Facebook login options
- **Laravel Sanctum**: Token-based API authentication for SPA/PWA

**Account Security:**

- Email verification required on signup
- Password reset flow with secure tokens
- Account recovery options
- Session management (view/revoke active sessions)
- Optional 2FA support (future enhancement)

**User Profile:**

- Username (unique, displayed in-game)
- Avatar (upload or select from presets)
- Email preferences (notifications, newsletter)
- Display settings (theme, language)

**Gaming Profile:**

- Total games played
- Championships won (across all campaigns)
- Career win/loss record
- Achievements system
- Play history (recent activity)
- Favorite team badge

**Achievements System:**

- **Rookie Achievements**: First win, first season completed, first draft
- **Veteran Achievements**: 5 championships, 100 wins, 10 seasons
- **Mastery Achievements**: Perfect season, dynasty (3-peat), Hall of Fame inductions
- **Hidden Achievements**: Special scenarios and easter eggs
- Achievement points contribute to player level/rank

**User Database Tables:**

```
users
├── id, email, password, username
├── avatar_url, email_verified_at
├── settings (JSON: theme, notifications, etc.)
└── created_at, updated_at

user_profiles
├── user_id, total_games, total_wins
├── championships, seasons_completed
├── favorite_team, player_level
└── play_time_hours

user_achievements
├── user_id, achievement_id
├── unlocked_at, progress
└── metadata (JSON)

achievements
├── id, name, description
├── category, points, icon
├── criteria (JSON), hidden
└── created_at

social_accounts (OAuth)
├── user_id, provider, provider_id
├── token, refresh_token
└── created_at
```

**API Endpoints (User Management):**

```
POST   /api/auth/register     - Create account
POST   /api/auth/login        - Email/password login
POST   /api/auth/social       - OAuth login
POST   /api/auth/logout       - End session
POST   /api/auth/forgot       - Password reset request
POST   /api/auth/reset        - Password reset confirm
GET    /api/auth/verify/{id}  - Email verification

GET    /api/user              - Current user profile
PUT    /api/user              - Update profile
PUT    /api/user/password     - Change password
POST   /api/user/avatar       - Upload avatar
DELETE /api/user              - Delete account

GET    /api/user/achievements - User's achievements
GET    /api/achievements      - All achievements list
GET    /api/user/stats        - Gaming statistics
```

**Frontend Views (User):**

- **Login/Register** - Auth forms with social buttons
- **Profile** - View/edit profile, avatar, settings
- **Achievements** - Achievement gallery with progress
- **Account Settings** - Security, email, password management

---

### 1. Player System

**Attributes (NBA 2K Style - 25+ ratings):**

- **Offense**: 3PT, Mid-Range, Post Scoring, Layup, Dunk, Ball Handling, Passing, Speed with Ball
- **Defense**: Perimeter D, Interior D, Steal, Block, Defensive IQ
- **Physical**: Speed, Acceleration, Strength, Vertical, Stamina
- **Mental**: Basketball IQ, Consistency, Clutch, Work Ethic

**Tendencies:**

- Shot selection preferences (3PT vs mid-range vs paint)
- Defensive aggression
- Passing willingness
- Help defense frequency

**Badge System:**

- ~50+ badges across categories (Finishing, Shooting, Playmaking, Defense)
- Badge levels: Bronze, Silver, Gold, Hall of Fame
- **Badge Synergy System**: Complementary badges create team boosts
  - Example: PG with "Pick & Roll Maestro" + C with "Good Hands" = +15% PnR efficiency
  - Synergies encourage thoughtful roster construction

**Personality System:**

- Traits affect locker room chemistry, media interactions, contract negotiations
- Examples: Team Player, Ball Hog, Mentor, Hot Head, Media Darling

**Player Development:**

- Age-based progression curves (peak years 27-31)
- Training focus areas
- Potential ratings (hidden, revealed through scouting)
- Regression for aging players

### 2. Coach System

**Coach Attributes:**

- Offensive IQ, Defensive IQ, Player Development, Motivation, Game Management

**Built-in Schemes:**

- **Offensive**: Motion, ISO-Heavy, Pick & Roll, Post-Up, Pace & Space, Princeton
- **Defensive**: Man-to-Man, 2-3 Zone, 3-2 Zone, Switch Everything, Drop Coverage

**Coach Impact:**

- Scheme affects player effectiveness (players may fit or struggle in system)
- Development bonus for players matching coach specialty
- In-game adjustments based on Coach IQ

### 3. Game Simulation Engine (JavaScript)

**Possession-by-Possession Simulation:**

```
Each possession:
1. Determine play call (based on coach scheme + personnel)
2. Execute play (affected by player ratings, badges, matchups)
3. Calculate outcome (make/miss/turnover/foul)
4. Apply badge synergies and situational modifiers
5. Update stats and fatigue
```

**Simulation Factors:**

- Player ratings & tendencies
- Badge effects & synergies
- Matchup advantages
- Fatigue levels
- Home court advantage
- Clutch situations
- Coach adjustments

**Visualization (2D Court):**

- Simple colored circles representing players
- Ball movement animation
- Shot arcs for makes/misses
- Play-by-play text feed alongside court
- Speed controls (instant, fast, normal, slow)

### 4. Franchise Management

**Roster Management:**

- 15-man rosters (13 active + 2 two-way)
- Depth chart / rotation settings
- Minutes distribution
- Rest day scheduling

**Financial System:**

- Salary cap (soft cap with luxury tax)
- Player contracts (years, salary, options, incentives)
- Cap holds for free agents
- Bird rights
- Mid-level and bi-annual exceptions

**Facilities:**

- Training facility (affects player development)
- Medical staff (affects injury recovery)
- Scouting department (affects draft evaluation)
- Analytics team (reveals hidden attributes)

**Staff:**

- Head Coach (hire/fire, scheme selection)
- Assistant Coaches (specialty bonuses)
- Training Staff
- Scouts

### 5. League Structure (NBA-Style)

**30 Teams:**

- 2 Conferences (East/West)
- 6 Divisions (3 per conference)
- Humorous parody names (e.g., "Los Angeles Fakers", "Chicago Bullies")

**Season Structure:**

- 82-game regular season
- Playoffs (7-game series, 16 teams)
- All-Star Weekend
- Draft Lottery
- Free Agency period
- Trade deadline

**Draft System:**

- Draft lottery for non-playoff teams
- 2-round draft
- Scouting system (reveals prospect ratings over time)
- Draft combine
- Rookie contracts

**Trade System:**

- AI trade logic (realistic valuations)
- Trade finder tool
- Salary matching requirements
- Trade deadline
- Draft pick trading (up to 7 years out)

### 6. Stats & Records

**Tracking:**

- Traditional stats (PTS, REB, AST, STL, BLK, TO, FG%, 3P%, FT%)
- Advanced stats (PER, WS, BPM, VORP, TS%, USG%)
- Team stats
- Historical stats (by season, career)

**Records & Awards:**

- League records (single game, season, career)
- MVP, DPOY, ROY, 6MOY, MIP
- All-NBA Teams
- Hall of Fame (automatic induction based on career achievements)

### 7. Injuries & Fatigue

**Injury System:**

- Random injuries based on player durability rating
- Injury types with varying recovery times
- Long-term injuries affect ratings

**Fatigue/Load Management:**

- Per-game fatigue based on minutes
- Season fatigue accumulation
- Rest benefits
- Back-to-back performance penalties

### 8. Media & Storylines

**Dynamic Events:**

- Trade rumors
- Contract disputes
- Locker room drama
- Breakout performances
- Player milestones
- Retirement announcements

**News Feed:**

- Generated articles based on game events
- Social media style updates
- Press conference quotes

### 9. Campaign/Save System

**Multiple Campaigns:**

- Users can have multiple franchise saves
- Cloud sync via Laravel backend
- Auto-save after each game/action
- Manual save slots

---

## Database Architecture (MySQL)

> **Design Principles:**
>
> 1. MySQL only (no Redis initially) - upgrade path available if needed
> 2. JSON columns for flexible nested data (attributes, badges, tendencies)
> 3. Hybrid data loading - core data upfront, details on demand
> 4. Aggregated stats retained, per-game details discarded after season
> 5. All-time records stored forever
> 6. Server is primary source of truth, local cache for offline PWA

---

### Data Loading Strategy

#### On Campaign Load (Upfront - Single Query Batch)

Load this data immediately when user opens a campaign:

```
- Campaign metadata (current season, date, team)
- User's team roster (15 players with full attributes)
- User's team finances (cap space, contracts summary)
- Current season schedule (remaining games)
- League standings (team names, W-L records)
- Active news feed (last 20 items)
```

**Target**: < 500ms, ~50KB payload

#### On Demand (Lazy Load)

Fetch when user navigates to specific views:

```
- Other team rosters → when viewing that team
- Full player details → when clicking a player card
- Historical stats → when viewing stats/records page
- Draft prospects → when entering draft room
- Free agents list → when opening free agency
- Trade finder results → when searching trades
```

#### Background Sync (Periodic)

Update silently while playing:

```
- Save campaign state → after each user action
- Sync standings → after simulating games
- Update news feed → every 5 game-days
```

---

### Detailed Table Schemas

#### Core Tables

```sql
-- ═══════════════════════════════════════════════════════════
-- USERS & AUTHENTICATION
-- ═══════════════════════════════════════════════════════════

CREATE TABLE users (
    id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
    email VARCHAR(255) UNIQUE NOT NULL,
    password VARCHAR(255) NOT NULL,
    username VARCHAR(50) UNIQUE NOT NULL,
    avatar_url VARCHAR(500) NULL,
    email_verified_at TIMESTAMP NULL,
    settings JSON DEFAULT '{}',
    -- settings: { theme: 'dark', simSpeed: 'normal', notifications: true }
    remember_token VARCHAR(100) NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

    INDEX idx_email (email),
    INDEX idx_username (username)
) ENGINE=InnoDB;

CREATE TABLE user_profiles (
    id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
    user_id BIGINT UNSIGNED UNIQUE NOT NULL,
    total_games INT UNSIGNED DEFAULT 0,
    total_wins INT UNSIGNED DEFAULT 0,
    championships INT UNSIGNED DEFAULT 0,
    seasons_completed INT UNSIGNED DEFAULT 0,
    play_time_minutes INT UNSIGNED DEFAULT 0,
    player_level INT UNSIGNED DEFAULT 1,
    experience_points INT UNSIGNED DEFAULT 0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE social_accounts (
    id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
    user_id BIGINT UNSIGNED NOT NULL,
    provider ENUM('google', 'apple', 'facebook') NOT NULL,
    provider_id VARCHAR(255) NOT NULL,
    token TEXT NULL,
    refresh_token TEXT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

    UNIQUE KEY unique_provider_account (provider, provider_id),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB;

-- ═══════════════════════════════════════════════════════════
-- CAMPAIGNS (Save Files)
-- ═══════════════════════════════════════════════════════════

CREATE TABLE campaigns (
    id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
    user_id BIGINT UNSIGNED NOT NULL,
    name VARCHAR(100) NOT NULL,
    team_id BIGINT UNSIGNED NOT NULL,          -- User's controlled team
    current_season_id BIGINT UNSIGNED NULL,    -- Active season
    current_date DATE NOT NULL,                 -- In-game date
    game_year INT UNSIGNED NOT NULL DEFAULT 1,  -- Years into franchise
    difficulty ENUM('rookie', 'pro', 'all_star', 'hall_of_fame') DEFAULT 'pro',
    settings JSON DEFAULT '{}',
    -- settings: { autoSave: true, injuryFrequency: 'normal', tradeFrequency: 'normal' }
    last_played_at TIMESTAMP NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

    INDEX idx_user_campaigns (user_id, last_played_at DESC),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB;

-- ═══════════════════════════════════════════════════════════
-- TEAMS
-- ═══════════════════════════════════════════════════════════

CREATE TABLE teams (
    id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
    campaign_id BIGINT UNSIGNED NOT NULL,
    name VARCHAR(100) NOT NULL,                 -- "Los Angeles Fakers"
    city VARCHAR(100) NOT NULL,                 -- "Los Angeles"
    abbreviation VARCHAR(5) NOT NULL,           -- "LAF"
    conference ENUM('east', 'west') NOT NULL,
    division VARCHAR(50) NOT NULL,              -- "Pacific"

    -- Financials (updated after transactions)
    salary_cap DECIMAL(12,2) DEFAULT 136000000,
    total_payroll DECIMAL(12,2) DEFAULT 0,
    luxury_tax_bill DECIMAL(12,2) DEFAULT 0,

    -- Facilities (affect gameplay)
    facilities JSON DEFAULT '{}',
    -- facilities: { training: 3, medical: 2, scouting: 2, analytics: 1 } (1-5 scale)

    -- Visual identity
    primary_color VARCHAR(7) DEFAULT '#000000',
    secondary_color VARCHAR(7) DEFAULT '#FFFFFF',
    logo_url VARCHAR(500) NULL,

    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

    INDEX idx_campaign_teams (campaign_id),
    INDEX idx_conference_division (campaign_id, conference, division),
    FOREIGN KEY (campaign_id) REFERENCES campaigns(id) ON DELETE CASCADE
) ENGINE=InnoDB;

-- ═══════════════════════════════════════════════════════════
-- PLAYERS (JSON columns for flexible attributes)
-- ═══════════════════════════════════════════════════════════

CREATE TABLE players (
    id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
    campaign_id BIGINT UNSIGNED NOT NULL,
    team_id BIGINT UNSIGNED NULL,               -- NULL = free agent

    -- Identity
    first_name VARCHAR(50) NOT NULL,
    last_name VARCHAR(50) NOT NULL,
    position ENUM('PG', 'SG', 'SF', 'PF', 'C') NOT NULL,
    secondary_position ENUM('PG', 'SG', 'SF', 'PF', 'C') NULL,
    jersey_number TINYINT UNSIGNED NULL,

    -- Physical (rarely changes)
    height_inches TINYINT UNSIGNED NOT NULL,    -- 72 = 6'0"
    weight_lbs SMALLINT UNSIGNED NOT NULL,
    birth_date DATE NOT NULL,

    -- Overall rating (denormalized for quick sorting/filtering)
    overall_rating TINYINT UNSIGNED NOT NULL,   -- 0-99, calculated from attributes
    potential_rating TINYINT UNSIGNED NOT NULL, -- Hidden until scouted

    -- ═══ JSON COLUMNS (Flexible, rarely queried directly) ═══

    attributes JSON NOT NULL,
    /* attributes: {
        offense: { threePoint: 85, midRange: 78, postScoring: 45, ... },
        defense: { perimeterD: 72, interiorD: 55, steal: 68, block: 42, ... },
        physical: { speed: 88, acceleration: 85, strength: 65, vertical: 80, stamina: 90 },
        mental: { basketballIQ: 82, consistency: 75, clutch: 88, workEthic: 70 }
    } */

    tendencies JSON NOT NULL,
    /* tendencies: {
        shotSelection: { threePoint: 0.45, midRange: 0.25, paint: 0.30 },
        defensiveAggression: 0.7,
        passingWillingness: 0.6,
        helpDefenseFrequency: 0.5
    } */

    badges JSON DEFAULT '[]',
    /* badges: [
        { id: 'catch_and_shoot', level: 'gold' },
        { id: 'pick_and_roll_maestro', level: 'hof' },
        ...
    ] */

    personality JSON DEFAULT '{}',
    /* personality: {
        traits: ['team_player', 'mentor'],
        morale: 80,
        chemistry: 75,
        mediaProfile: 'low_key'
    } */

    -- Contract (denormalized for cap calculations)
    contract_years_remaining TINYINT UNSIGNED DEFAULT 0,
    contract_salary DECIMAL(12,2) DEFAULT 0,
    contract_details JSON DEFAULT '{}',
    /* contract_details: {
        totalYears: 4,
        salaries: [35000000, 37000000, 39000000, 41000000],
        options: { year4: 'player' },
        noTradeClause: false,
        signedYear: 2024
    } */

    -- Status
    is_injured BOOLEAN DEFAULT FALSE,
    injury_details JSON NULL,
    /* injury_details: { type: 'ankle_sprain', gamesOut: 5, severity: 'minor' } */

    fatigue TINYINT UNSIGNED DEFAULT 0,         -- 0-100, resets with rest

    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

    -- INDEXES: Only on columns we actually filter/sort by
    INDEX idx_campaign_players (campaign_id),
    INDEX idx_team_roster (team_id),
    INDEX idx_free_agents (campaign_id, team_id, overall_rating DESC),
    INDEX idx_position_rating (campaign_id, position, overall_rating DESC),

    FOREIGN KEY (campaign_id) REFERENCES campaigns(id) ON DELETE CASCADE,
    FOREIGN KEY (team_id) REFERENCES teams(id) ON DELETE SET NULL
) ENGINE=InnoDB;

-- ═══════════════════════════════════════════════════════════
-- COACHES
-- ═══════════════════════════════════════════════════════════

CREATE TABLE coaches (
    id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
    campaign_id BIGINT UNSIGNED NOT NULL,
    team_id BIGINT UNSIGNED NULL,               -- NULL = available to hire

    first_name VARCHAR(50) NOT NULL,
    last_name VARCHAR(50) NOT NULL,

    -- Ratings
    overall_rating TINYINT UNSIGNED NOT NULL,

    attributes JSON NOT NULL,
    /* attributes: {
        offensiveIQ: 85,
        defensiveIQ: 72,
        playerDevelopment: 80,
        motivation: 75,
        gameManagement: 78
    } */

    -- Schemes (what they bring to the team)
    offensive_scheme ENUM('motion', 'iso_heavy', 'pick_and_roll', 'post_up', 'pace_and_space', 'princeton') NOT NULL,
    defensive_scheme ENUM('man_to_man', 'zone_2_3', 'zone_3_2', 'switch_everything', 'drop_coverage') NOT NULL,

    -- Contract
    contract_years_remaining TINYINT UNSIGNED DEFAULT 0,
    contract_salary DECIMAL(12,2) DEFAULT 0,

    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

    INDEX idx_campaign_coaches (campaign_id),
    INDEX idx_available_coaches (campaign_id, team_id, overall_rating DESC),

    FOREIGN KEY (campaign_id) REFERENCES campaigns(id) ON DELETE CASCADE,
    FOREIGN KEY (team_id) REFERENCES teams(id) ON DELETE SET NULL
) ENGINE=InnoDB;

-- ═══════════════════════════════════════════════════════════
-- SEASONS
-- ═══════════════════════════════════════════════════════════

CREATE TABLE seasons (
    id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
    campaign_id BIGINT UNSIGNED NOT NULL,
    year INT UNSIGNED NOT NULL,                 -- 2024
    phase ENUM('preseason', 'regular', 'playoffs', 'offseason', 'draft', 'free_agency') DEFAULT 'preseason',

    -- Cached standings (updated after each game)
    standings JSON DEFAULT '{}',
    /* standings: {
        east: [{ teamId: 1, wins: 45, losses: 20, streak: 'W3' }, ...],
        west: [{ teamId: 16, wins: 50, losses: 15, streak: 'L1' }, ...]
    } */

    -- Playoff bracket (populated when playoffs start)
    playoff_bracket JSON NULL,

    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

    UNIQUE KEY unique_campaign_season (campaign_id, year),
    FOREIGN KEY (campaign_id) REFERENCES campaigns(id) ON DELETE CASCADE
) ENGINE=InnoDB;

-- ═══════════════════════════════════════════════════════════
-- GAMES (Current season only - detailed)
-- ═══════════════════════════════════════════════════════════

CREATE TABLE games (
    id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
    season_id BIGINT UNSIGNED NOT NULL,

    home_team_id BIGINT UNSIGNED NOT NULL,
    away_team_id BIGINT UNSIGNED NOT NULL,

    game_date DATE NOT NULL,
    is_playoff BOOLEAN DEFAULT FALSE,
    playoff_round TINYINT UNSIGNED NULL,        -- 1-4
    playoff_game_number TINYINT UNSIGNED NULL,  -- 1-7

    -- Results (NULL if not yet played)
    home_score SMALLINT UNSIGNED NULL,
    away_score SMALLINT UNSIGNED NULL,
    is_complete BOOLEAN DEFAULT FALSE,

    -- Box score (stored as JSON, discarded after season)
    box_score JSON NULL,
    /* box_score: {
        home: { players: [{ playerId: 1, pts: 28, reb: 8, ast: 5, ... }], teamStats: {...} },
        away: { players: [...], teamStats: {...} }
    } */

    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

    INDEX idx_season_games (season_id, game_date),
    INDEX idx_team_schedule (season_id, home_team_id),
    INDEX idx_team_schedule_away (season_id, away_team_id),

    FOREIGN KEY (season_id) REFERENCES seasons(id) ON DELETE CASCADE,
    FOREIGN KEY (home_team_id) REFERENCES teams(id) ON DELETE CASCADE,
    FOREIGN KEY (away_team_id) REFERENCES teams(id) ON DELETE CASCADE
) ENGINE=InnoDB;
```

#### Stats Tables (Aggregated)

```sql
-- ═══════════════════════════════════════════════════════════
-- PLAYER SEASON STATS (Aggregated - kept forever)
-- ═══════════════════════════════════════════════════════════

CREATE TABLE player_season_stats (
    id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
    player_id BIGINT UNSIGNED NOT NULL,
    season_id BIGINT UNSIGNED NOT NULL,
    team_id BIGINT UNSIGNED NOT NULL,

    -- Counting stats (totals for the season)
    games_played SMALLINT UNSIGNED DEFAULT 0,
    games_started SMALLINT UNSIGNED DEFAULT 0,
    minutes_played INT UNSIGNED DEFAULT 0,

    -- Per-game stats stored as totals (divide by games_played for averages)
    points INT UNSIGNED DEFAULT 0,
    rebounds INT UNSIGNED DEFAULT 0,
    offensive_rebounds INT UNSIGNED DEFAULT 0,
    defensive_rebounds INT UNSIGNED DEFAULT 0,
    assists INT UNSIGNED DEFAULT 0,
    steals INT UNSIGNED DEFAULT 0,
    blocks INT UNSIGNED DEFAULT 0,
    turnovers INT UNSIGNED DEFAULT 0,
    personal_fouls INT UNSIGNED DEFAULT 0,

    -- Shooting
    field_goals_made INT UNSIGNED DEFAULT 0,
    field_goals_attempted INT UNSIGNED DEFAULT 0,
    three_pointers_made INT UNSIGNED DEFAULT 0,
    three_pointers_attempted INT UNSIGNED DEFAULT 0,
    free_throws_made INT UNSIGNED DEFAULT 0,
    free_throws_attempted INT UNSIGNED DEFAULT 0,

    -- Advanced (calculated at end of season)
    player_efficiency_rating DECIMAL(5,2) NULL,
    true_shooting_pct DECIMAL(5,4) NULL,
    usage_rate DECIMAL(5,4) NULL,
    win_shares DECIMAL(5,2) NULL,

    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

    UNIQUE KEY unique_player_season (player_id, season_id),
    INDEX idx_season_leaders (season_id, points DESC),

    FOREIGN KEY (player_id) REFERENCES players(id) ON DELETE CASCADE,
    FOREIGN KEY (season_id) REFERENCES seasons(id) ON DELETE CASCADE,
    FOREIGN KEY (team_id) REFERENCES teams(id) ON DELETE CASCADE
) ENGINE=InnoDB;

-- ═══════════════════════════════════════════════════════════
-- TEAM SEASON STATS (Aggregated - kept forever)
-- ═══════════════════════════════════════════════════════════

CREATE TABLE team_season_stats (
    id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
    team_id BIGINT UNSIGNED NOT NULL,
    season_id BIGINT UNSIGNED NOT NULL,

    wins SMALLINT UNSIGNED DEFAULT 0,
    losses SMALLINT UNSIGNED DEFAULT 0,
    home_wins SMALLINT UNSIGNED DEFAULT 0,
    home_losses SMALLINT UNSIGNED DEFAULT 0,

    -- Offensive totals
    points_scored INT UNSIGNED DEFAULT 0,
    points_allowed INT UNSIGNED DEFAULT 0,

    -- Playoff results
    playoff_seed TINYINT UNSIGNED NULL,
    playoff_result ENUM('missed', 'first_round', 'second_round', 'conf_finals', 'finals', 'champion') NULL,

    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

    UNIQUE KEY unique_team_season (team_id, season_id),

    FOREIGN KEY (team_id) REFERENCES teams(id) ON DELETE CASCADE,
    FOREIGN KEY (season_id) REFERENCES seasons(id) ON DELETE CASCADE
) ENGINE=InnoDB;

-- ═══════════════════════════════════════════════════════════
-- ALL-TIME RECORDS (Kept forever)
-- ═══════════════════════════════════════════════════════════

CREATE TABLE records (
    id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
    campaign_id BIGINT UNSIGNED NOT NULL,

    record_type ENUM('single_game', 'season', 'career', 'franchise') NOT NULL,
    category VARCHAR(50) NOT NULL,              -- 'points', 'rebounds', 'assists', etc.

    record_value DECIMAL(10,2) NOT NULL,

    -- Who holds the record
    player_id BIGINT UNSIGNED NULL,             -- NULL for team records
    team_id BIGINT UNSIGNED NULL,
    season_id BIGINT UNSIGNED NULL,             -- NULL for career records
    game_id BIGINT UNSIGNED NULL,               -- Only for single_game records

    -- Context
    description VARCHAR(255) NULL,              -- "Most points in a single game"
    achieved_date DATE NOT NULL,

    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

    INDEX idx_campaign_records (campaign_id, record_type, category),

    FOREIGN KEY (campaign_id) REFERENCES campaigns(id) ON DELETE CASCADE
) ENGINE=InnoDB;

-- ═══════════════════════════════════════════════════════════
-- HALL OF FAME
-- ═══════════════════════════════════════════════════════════

CREATE TABLE hall_of_fame (
    id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
    campaign_id BIGINT UNSIGNED NOT NULL,
    player_id BIGINT UNSIGNED NOT NULL,

    -- Career totals at time of induction
    career_stats JSON NOT NULL,
    /* career_stats: {
        seasons: 15, games: 1150, points: 28450, rebounds: 8200, assists: 7500,
        championships: 4, mvps: 2, allStarSelections: 12, allNbaTeams: 10
    } */

    induction_year INT UNSIGNED NOT NULL,
    inducted_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

    UNIQUE KEY unique_hof_player (campaign_id, player_id),

    FOREIGN KEY (campaign_id) REFERENCES campaigns(id) ON DELETE CASCADE,
    FOREIGN KEY (player_id) REFERENCES players(id) ON DELETE CASCADE
) ENGINE=InnoDB;
```

#### Supporting Tables

```sql
-- ═══════════════════════════════════════════════════════════
-- DRAFT PICKS (Tradeable assets)
-- ═══════════════════════════════════════════════════════════

CREATE TABLE draft_picks (
    id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
    campaign_id BIGINT UNSIGNED NOT NULL,

    original_team_id BIGINT UNSIGNED NOT NULL,  -- Team that "generated" the pick
    current_owner_id BIGINT UNSIGNED NOT NULL,  -- Team that currently owns it

    year INT UNSIGNED NOT NULL,
    round TINYINT UNSIGNED NOT NULL,            -- 1 or 2

    -- After draft lottery / draft
    pick_number TINYINT UNSIGNED NULL,          -- 1-60
    player_id BIGINT UNSIGNED NULL,             -- Player selected (if used)

    -- Trade tracking
    is_traded BOOLEAN DEFAULT FALSE,
    trade_conditions JSON NULL,                 -- Protection details

    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

    INDEX idx_owner_picks (current_owner_id, year),

    FOREIGN KEY (campaign_id) REFERENCES campaigns(id) ON DELETE CASCADE,
    FOREIGN KEY (original_team_id) REFERENCES teams(id) ON DELETE CASCADE,
    FOREIGN KEY (current_owner_id) REFERENCES teams(id) ON DELETE CASCADE
) ENGINE=InnoDB;

-- ═══════════════════════════════════════════════════════════
-- TRADES
-- ═══════════════════════════════════════════════════════════

CREATE TABLE trades (
    id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
    campaign_id BIGINT UNSIGNED NOT NULL,
    season_id BIGINT UNSIGNED NOT NULL,

    trade_date DATE NOT NULL,

    -- Trade details stored as JSON (complex many-to-many)
    details JSON NOT NULL,
    /* details: {
        teams: [teamId1, teamId2, teamId3],
        assets: [
            { from: teamId1, to: teamId2, type: 'player', playerId: 123 },
            { from: teamId2, to: teamId1, type: 'player', playerId: 456 },
            { from: teamId2, to: teamId1, type: 'pick', pickId: 789 }
        ]
    } */

    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

    INDEX idx_campaign_trades (campaign_id, trade_date DESC),

    FOREIGN KEY (campaign_id) REFERENCES campaigns(id) ON DELETE CASCADE,
    FOREIGN KEY (season_id) REFERENCES seasons(id) ON DELETE CASCADE
) ENGINE=InnoDB;

-- ═══════════════════════════════════════════════════════════
-- NEWS / STORYLINES
-- ═══════════════════════════════════════════════════════════

CREATE TABLE news_events (
    id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
    campaign_id BIGINT UNSIGNED NOT NULL,

    event_type ENUM('trade', 'injury', 'milestone', 'contract', 'drama', 'award', 'retirement', 'general') NOT NULL,
    headline VARCHAR(255) NOT NULL,
    body TEXT NULL,

    -- Related entities
    player_id BIGINT UNSIGNED NULL,
    team_id BIGINT UNSIGNED NULL,

    game_date DATE NOT NULL,                    -- In-game date of event
    is_read BOOLEAN DEFAULT FALSE,

    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

    INDEX idx_campaign_news (campaign_id, game_date DESC),
    INDEX idx_unread_news (campaign_id, is_read, game_date DESC),

    FOREIGN KEY (campaign_id) REFERENCES campaigns(id) ON DELETE CASCADE
) ENGINE=InnoDB;

-- ═══════════════════════════════════════════════════════════
-- BADGE DEFINITIONS (Static reference data)
-- ═══════════════════════════════════════════════════════════

CREATE TABLE badge_definitions (
    id VARCHAR(50) PRIMARY KEY,                 -- 'catch_and_shoot'
    name VARCHAR(100) NOT NULL,                 -- 'Catch and Shoot'
    category ENUM('finishing', 'shooting', 'playmaking', 'defense', 'physical') NOT NULL,
    description TEXT NOT NULL,

    -- Effect at each level (JSON for flexibility)
    effects JSON NOT NULL,
    /* effects: {
        bronze: { openShotBoost: 0.02 },
        silver: { openShotBoost: 0.04 },
        gold: { openShotBoost: 0.06 },
        hof: { openShotBoost: 0.10 }
    } */

    icon_url VARCHAR(500) NULL
) ENGINE=InnoDB;

-- ═══════════════════════════════════════════════════════════
-- BADGE SYNERGIES (Static reference data)
-- ═══════════════════════════════════════════════════════════

CREATE TABLE badge_synergies (
    id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,

    badge1_id VARCHAR(50) NOT NULL,
    badge2_id VARCHAR(50) NOT NULL,

    synergy_name VARCHAR(100) NOT NULL,         -- "Pick & Roll Connection"
    description TEXT NOT NULL,

    -- Effect when both badges are present on teammates
    effect JSON NOT NULL,
    /* effect: {
        condition: 'pick_and_roll',
        boost: { screenEffectiveness: 0.15, rollerFinishing: 0.10 }
    } */

    -- Minimum badge levels required
    min_level1 ENUM('bronze', 'silver', 'gold', 'hof') DEFAULT 'bronze',
    min_level2 ENUM('bronze', 'silver', 'gold', 'hof') DEFAULT 'bronze',

    FOREIGN KEY (badge1_id) REFERENCES badge_definitions(id),
    FOREIGN KEY (badge2_id) REFERENCES badge_definitions(id)
) ENGINE=InnoDB;

-- ═══════════════════════════════════════════════════════════
-- ACHIEVEMENTS (User meta-game)
-- ═══════════════════════════════════════════════════════════

CREATE TABLE achievements (
    id VARCHAR(50) PRIMARY KEY,                 -- 'first_championship'
    name VARCHAR(100) NOT NULL,
    description TEXT NOT NULL,
    category ENUM('rookie', 'veteran', 'mastery', 'hidden') NOT NULL,
    points INT UNSIGNED DEFAULT 10,
    icon_url VARCHAR(500) NULL,

    -- Unlock criteria
    criteria JSON NOT NULL
    /* criteria: { type: 'championships', value: 1 } */
) ENGINE=InnoDB;

CREATE TABLE user_achievements (
    id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
    user_id BIGINT UNSIGNED NOT NULL,
    achievement_id VARCHAR(50) NOT NULL,
    campaign_id BIGINT UNSIGNED NULL,           -- Which campaign unlocked it

    unlocked_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

    UNIQUE KEY unique_user_achievement (user_id, achievement_id),

    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (achievement_id) REFERENCES achievements(id)
) ENGINE=InnoDB;
```

---

### Query Optimization Patterns

#### 1. Eager Loading Relationships (Laravel)

```php
// BAD: N+1 queries
$players = Player::where('team_id', $teamId)->get();
foreach ($players as $player) {
    echo $player->team->name; // Query per player!
}

// GOOD: Single query with join
$players = Player::with('team')
    ->where('team_id', $teamId)
    ->get();
```

#### 2. Select Only Needed Columns

```php
// BAD: Fetches all JSON columns even when not needed
$players = Player::where('team_id', $teamId)->get();

// GOOD: Fetch only display columns for list views
$players = Player::select([
    'id', 'first_name', 'last_name', 'position',
    'overall_rating', 'jersey_number'
])
->where('team_id', $teamId)
->get();

// Fetch full details only when viewing single player
$player = Player::find($id); // All columns including JSON
```

#### 3. JSON Column Queries (Use Sparingly)

```php
// Searching within JSON - USE INDEXES or avoid in hot paths
// This works but isn't indexed:
$shooters = Player::whereRaw(
    "JSON_EXTRACT(attributes, '$.offense.threePoint') > 80"
)->get();

// BETTER: Use the denormalized overall_rating for filtering,
// then filter in PHP for detailed attributes
$goodPlayers = Player::where('overall_rating', '>', 75)->get();
$shooters = $goodPlayers->filter(fn($p) =>
    $p->attributes['offense']['threePoint'] > 80
);
```

#### 4. Batch Updates

```php
// BAD: Update each player individually after game
foreach ($players as $player) {
    $player->update(['fatigue' => $newFatigue]);
}

// GOOD: Batch update with CASE statement
Player::whereIn('id', $playerIds)
    ->update(['fatigue' => DB::raw("
        CASE id
            WHEN 1 THEN 25
            WHEN 2 THEN 30
            WHEN 3 THEN 15
        END
    ")]);
```

#### 5. Caching Strategy

```php
// Cache standings for 5 minutes (updates after each game anyway)
$standings = Cache::remember(
    "campaign.{$campaignId}.standings",
    300,
    fn() => $this->calculateStandings($campaignId)
);

// Cache badge definitions forever (static data)
$badges = Cache::rememberForever(
    'badge_definitions',
    fn() => BadgeDefinition::all()->keyBy('id')
);

// Invalidate on relevant changes
Cache::forget("campaign.{$campaignId}.standings");
```

---

### Data Retention Policy

| Data Type                 | Retention             | When Pruned   |
| ------------------------- | --------------------- | ------------- |
| Box scores (game details) | Current season only   | End of season |
| Player season stats       | Forever               | Never         |
| Team season stats         | Forever               | Never         |
| All-time records          | Forever               | Never         |
| Hall of Fame              | Forever               | Never         |
| News events               | Last 100 per campaign | On new event  |
| Trade history             | Forever               | Never         |

#### Season End Cleanup Job

```php
// Run at end of each season
public function endSeasonCleanup(Season $season)
{
    // 1. Calculate final advanced stats
    $this->calculateAdvancedStats($season);

    // 2. Check for new records
    $this->updateRecords($season);

    // 3. Check Hall of Fame eligibility
    $this->checkHallOfFame($season);

    // 4. Clear box scores (keep only stats)
    Game::where('season_id', $season->id)
        ->update(['box_score' => null]);

    // 5. Archive season (optional compression)
    $season->update(['is_archived' => true]);
}
```

---

### Offline PWA Strategy

#### Local Storage (IndexedDB via Dexie.js)

```javascript
// Store campaign snapshot locally for offline play
const db = new Dexie("BballSimOffline");
db.version(1).stores({
  campaigns: "id, lastSynced",
  pendingActions: "++id, campaignId, timestamp",
});

// On campaign load - cache for offline
async function cacheCampaign(campaign) {
  await db.campaigns.put({
    id: campaign.id,
    data: campaign,
    lastSynced: Date.now(),
  });
}

// Queue actions when offline
async function queueAction(action) {
  if (!navigator.onLine) {
    await db.pendingActions.add({
      campaignId: action.campaignId,
      action: action,
      timestamp: Date.now(),
    });
  }
}

// Sync when back online
window.addEventListener("online", async () => {
  const pending = await db.pendingActions.toArray();
  for (const item of pending) {
    await api.syncAction(item.action);
    await db.pendingActions.delete(item.id);
  }
});
```

#### Server Sync Endpoints

```
POST /api/campaigns/{id}/sync
    - Receives batched offline actions
    - Validates and applies in order
    - Returns updated campaign state

GET /api/campaigns/{id}/snapshot
    - Returns full campaign data for offline caching
    - Includes: team, roster, schedule, standings, finances
```

---

## API Structure (Laravel)

### Endpoints

```
/api/auth/*           - Authentication
/api/campaigns/*      - Campaign CRUD
/api/teams/*          - Team data
/api/players/*        - Player data
/api/games/*          - Game simulation, results
/api/draft/*          - Draft operations
/api/trades/*         - Trade operations
/api/free-agency/*    - Free agency
/api/stats/*          - Statistics queries
```

---

## Frontend Architecture (Vue 3)

### Key Views

- **Auth** - Login, register, password reset, social login
- **Profile** - User profile, avatar, gaming stats, achievements
- **Dashboard** - Campaign overview, upcoming games, news feed
- **Team Management** - Roster, depth chart, finances
- **Game Center** - Live simulation view with 2D court
- **League** - Standings, schedules, other teams
- **Draft** - Scouting, draft board, draft room
- **Free Agency** - Available players, negotiations
- **Trade Center** - Trade finder, negotiations
- **Stats** - League leaders, records, history
- **Settings** - Game options, account settings, simulation speed

### Modal Views

#### Player Detail Modal

A glassmorphism modal popup accessible from roster, depth chart, league views, or anywhere a player is displayed. **View-only** - management actions remain on the parent view.

**Tabs:**
| Tab | Contents |
|-----|----------|
| **Overview** | Photo/avatar, name, position, team, jersey #, overall rating, age, height/weight, contract summary |
| **Attributes** | Full attribute breakdown by category (Offense, Defense, Physical, Mental) with stat badges |
| **Badges** | All badges with level indicators (Bronze/Silver/Gold/HOF), grouped by category, synergy indicators |
| **Stats** | Current season stats, career averages, season-by-season history (if available) |
| **Contract** | Contract details, years remaining, salary breakdown, options, bird rights status |

**Component Structure:**

```
components/
└── modals/
    └── PlayerDetailModal.vue
        ├── PlayerOverviewTab.vue
        ├── PlayerAttributesTab.vue
        ├── PlayerBadgesTab.vue
        ├── PlayerStatsTab.vue
        └── PlayerContractTab.vue
```

**Trigger Points:**

- Click player card in Team Management roster
- Click player row in depth chart
- Click player name in standings/stats leaderboards
- Click player in trade/free agency lists
- Click player name in news feed stories

---

#### Coach Detail Modal

A glassmorphism modal popup for viewing and managing coach information. **Allows scheme changes** for your team's coach - hire/fire actions remain on Staff management view.

**Tabs:**
| Tab | Contents |
|-----|----------|
| **Overview** | Photo/avatar, name, overall rating, current team, contract summary, years of experience |
| **Schemes** | Offensive & defensive scheme with trait tags (see below) - **editable for your coach** |
| **Attributes** | Full attribute breakdown (Offensive IQ, Defensive IQ, Player Development, Motivation, Game Management) |
| **History** | Coaching record, championships, past teams, awards |

**Scheme Selection (Your Coach Only):**
When viewing your own team's coach, the Schemes tab includes dropdowns to change the active offensive and defensive schemes. Each coach knows all schemes but has preferred schemes where they provide bonuses.

```
┌─────────────────────────────────────────────────────────┐
│  OFFENSIVE SCHEME                                       │
│  ┌──────────────────────────────────────────┐           │
│  │  Pace & Space                        ▼   │ ← Dropdown│
│  └──────────────────────────────────────────┘           │
│  ⭐ Coach's preferred scheme (+5% effectiveness)        │
│                                                         │
│  [Fast Pace] [3PT Heavy] [Spread Floor] [Motion]        │
│                                                         │
│  Best for: Shooting guards, stretch bigs                │
│  Weak against: Physical interior defense                │
│                                                         │
│  Player Fit Analysis:                                   │
│  ✓ 4 players fit well   ⚠ 2 neutral   ✗ 1 poor fit     │
└─────────────────────────────────────────────────────────┘
```

**Scheme Change Effects:**

- Immediate: New scheme active for next game
- Player fit recalculated (shown in modal)
- Some players may see rating boosts/penalties based on scheme fit

**Scheme Display (Simple Tags):**

```
┌─────────────────────────────────────────────────────────┐
│  OFFENSIVE SCHEME                                       │
│  ┌──────────────────┐                                   │
│  │  PACE & SPACE    │                                   │
│  └──────────────────┘                                   │
│                                                         │
│  [Fast Pace] [3PT Heavy] [Spread Floor] [Motion]        │
│                                                         │
│  Best for: Shooting guards, stretch bigs                │
│  Weak against: Physical interior defense                │
├─────────────────────────────────────────────────────────┤
│  DEFENSIVE SCHEME                                       │
│  ┌──────────────────┐                                   │
│  │  SWITCH EVERYTHING│                                  │
│  └──────────────────┘                                   │
│                                                         │
│  [Versatile] [Perimeter Focus] [Communication]          │
│                                                         │
│  Best for: Athletic wings, versatile defenders          │
│  Weak against: Elite post players, mismatches           │
└─────────────────────────────────────────────────────────┘
```

**Scheme Trait Tags:**
| Offensive Schemes | Tags |
|-------------------|------|
| Motion | `Ball Movement` `Cuts` `Spacing` `Read & React` |
| ISO-Heavy | `Star Driven` `1-on-1` `Slow Pace` `High Usage` |
| Pick & Roll | `PnR Heavy` `Ball Handler` `Roll Man` `Spacing` |
| Post-Up | `Interior Focus` `Back to Basket` `Slow Pace` `Physical` |
| Pace & Space | `Fast Pace` `3PT Heavy` `Spread Floor` `Motion` |
| Princeton | `Backdoor Cuts` `High Post` `Ball Movement` `Patient` |

| Defensive Schemes | Tags                                             |
| ----------------- | ------------------------------------------------ |
| Man-to-Man        | `Individual` `Accountability` `Versatile`        |
| 2-3 Zone          | `Interior Protection` `Rebounding` `Paint Focus` |
| 3-2 Zone          | `Perimeter Denial` `Traps` `Turnover Forcing`    |
| Switch Everything | `Versatile` `Perimeter Focus` `Communication`    |
| Drop Coverage     | `Rim Protection` `PnR Defense` `Controlled`      |

**Component Structure:**

```
components/
└── modals/
    └── CoachDetailModal.vue
        ├── CoachOverviewTab.vue
        ├── CoachSchemesTab.vue
        ├── CoachAttributesTab.vue
        └── CoachHistoryTab.vue
```

**Trigger Points:**

- Click coach card in Team Management staff section
- Click coach name in league coaching standings
- Click coach during hire/fire flow
- Click coach name in news feed stories

---

#### Modal Base Component

Shared glassmorphism modal wrapper for consistent styling:

```vue
<!-- components/modals/BaseModal.vue -->
<template>
  <Teleport to="body">
    <Transition name="modal">
      <div v-if="isOpen" class="modal-overlay" @click.self="close">
        <div class="modal-container glass-card-elevated">
          <header class="modal-header">
            <slot name="header" />
            <button class="btn-ghost" @click="close">
              <XMarkIcon class="icon-md" />
            </button>
          </header>

          <nav v-if="tabs.length" class="modal-tabs">
            <button
              v-for="tab in tabs"
              :key="tab.id"
              :class="['tab', { active: activeTab === tab.id }]"
              @click="activeTab = tab.id"
            >
              {{ tab.label }}
            </button>
          </nav>

          <main class="modal-content">
            <slot :activeTab="activeTab" />
          </main>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>
```

**Modal Animations:**

- Overlay: Fade in `--duration-fast`
- Container: Scale in from 0.95 + fade `--duration-normal`
- Tab content: Fade transition between tabs

---

### State Management (Pinia)

- `useAuthStore` - User authentication state, profile, achievements
- `useGameStore` - Active game simulation state
- `useCampaignStore` - Current campaign data
- `useTeamStore` - User's team data
- `useLeagueStore` - League-wide data
- `useModalStore` - Modal state (open/close, active entity ID, active tab)

---

## PWA Features

- **Installable** - Add to home screen on mobile
- **Offline Support** - Play single-player offline
- **Background Sync** - Sync campaigns when online
- **Push Notifications** - (Future) Game reminders, trade offers

---

## Development Phases

### Phase 1: Foundation (MVP Core)

1. Laravel project setup with Sanctum authentication
2. Full user management system (registration, login, profile)
3. Social OAuth integration (Google, Apple, Facebook)
4. Vue 3 + Vite + Pinia setup with PWA config
5. **Design system implementation** (CSS variables, typography, base components)
6. **Core UI components** (GlassCard, Button, Input, StatBadge)
7. User authentication flows in frontend
8. Database schema and migrations
9. Basic player/team data models
10. Simple game simulation engine (no visualization)
11. Single season playthrough capability

### Phase 2: Core Gameplay

1. Full attribute and badge system
2. Badge synergy implementation
3. Coach system with schemes
4. 2D court visualization
5. Complete game simulation with all factors
6. Box scores and game recaps

### Phase 3: Franchise Depth

1. Full financial system (salary cap, contracts)
2. Draft system with scouting
3. Trade system with AI logic
4. Free agency
5. Staff and facilities

### Phase 4: Immersion

1. Player development system
2. Injuries and fatigue
3. Media and storylines
4. Stats and records tracking
5. Hall of Fame

### Phase 5: Polish & Multiplayer

1. Multiple campaign support
2. Cloud sync optimization
3. PWA optimization (offline, caching)
4. Online leagues (multiplayer)
5. Head-to-head play

---

## Data Seeding Strategy

**Initial Data Set:**

- 30 NBA-parody teams with rosters
- ~450 players with full attributes
- Humorous name generator for future drafts
- Historical draft classes for "legends" mode

**Name Generation Examples:**

- LeBron James → "LeBroom James"
- Stephen Curry → "Steffen Curry"
- Kevin Durant → "Kevin Durand"
- Lakers → "Los Angeles Fakers"
- Warriors → "Golden State Worriers"

---

## Key Technical Decisions

| Decision                 | Rationale                                             |
| ------------------------ | ----------------------------------------------------- |
| **JS Simulation Engine** | Fast, responsive, works offline, smooth visualization |
| **Laravel API**          | Robust, familiar, handles auth/persistence well       |
| **Pinia for State**      | Vue 3 native, handles complex nested game state       |
| **Canvas for Court**     | Performant 2D rendering, full control over visuals    |
| **PWA over Native**      | Faster development, no app store, instant updates     |

---

## Success Metrics for MVP

- [ ] User can register/login (email or social OAuth)
- [ ] User profile with gaming stats and achievements
- [ ] User can start a new franchise campaign
- [ ] User can manage roster and lineups
- [ ] User can simulate games with 2D visualization
- [ ] User can complete a full season with playoffs
- [ ] User can participate in draft
- [ ] Badge synergies affect game outcomes
- [ ] Campaign saves persist across sessions
- [ ] Achievements unlock based on player actions
- [ ] Works as installable PWA on mobile
- [ ] **Consistent vaporwave/glassmorphism UI across all views**
- [ ] **Responsive design works on mobile, tablet, desktop**

---

## Next Steps

1. **Project Initialization**

   - Set up Laravel project with Sanctum auth
   - Set up Vue 3 project with Vite, Pinia, PWA plugin
   - Configure development environment

2. **Data Modeling**

   - Finalize database schema
   - Create migrations
   - Build seeders for initial team/player data

3. **Simulation Engine**

   - Design possession-by-possession algorithm
   - Implement badge and synergy effects
   - Build 2D court renderer

4. **Core Loop**
   - Build game day flow
   - Implement season progression
   - Create basic UI for management
