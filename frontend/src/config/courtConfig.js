/**
 * Basketball Court Configuration
 *
 * This file contains all the dimensions and settings for rendering the half-court
 * basketball visualization. All measurements are in feet based on NBA regulations,
 * then scaled to canvas pixels.
 *
 * COORDINATE SYSTEM:
 * - Origin (0,0) is top-left of canvas
 * - X: 0 = left sideline, 1 = right sideline (maps to 50 feet court width)
 * - Y: 0 = top of visible court (around 3-point arc apex), 1 = baseline
 *
 * When creating plays, player positions should use normalized coordinates (0-1)
 * that map to the visible court area.
 */

// NBA Court Dimensions (in feet)
export const NBA_COURT = {
  // Full court dimensions
  FULL_LENGTH: 94,
  FULL_WIDTH: 50,

  // Half court (what we display)
  HALF_LENGTH: 47,

  // Basket/Rim
  BACKBOARD_FROM_BASELINE: 4,
  RIM_FROM_BASELINE: 5.25,  // Center of rim
  RIM_DIAMETER: 1.5,        // 18 inches

  // Key/Paint
  KEY_WIDTH: 16,
  KEY_LENGTH: 19,           // From baseline to free throw line

  // Free throw
  FT_CIRCLE_RADIUS: 6,

  // Restricted area
  RESTRICTED_RADIUS: 4,

  // 3-Point line
  THREE_POINT_ARC_RADIUS: 23.75,
  THREE_POINT_CORNER_DIST: 22,    // Distance from basket in corners
  CORNER_THREE_FROM_SIDELINE: 3,  // 3 feet from sideline (50/2 - 22 = 3)

  // Backboard
  BACKBOARD_WIDTH: 6,
}

// Canvas rendering configuration
export const COURT_CANVAS = {
  // Default canvas dimensions
  DEFAULT_WIDTH: 400,
  DEFAULT_HEIGHT: 380,

  // How much of the court depth to show (in feet)
  // This determines the vertical scaling
  VISIBLE_DEPTH: 32,

  // Crowd area below baseline (in pixels)
  CROWD_AREA_HEIGHT: 45,

  // Court colors
  COLORS: {
    HARDWOOD: '#CD853F',
    WOOD_GRAIN: 'rgba(139, 90, 43, 0.15)',
    COURT_LINES: '#FFFFFF',
    RIM: '#FF4500',
    CROWD_FLOOR: '#1a1a2e',  // Dark floor behind baseline
  },

  // Line widths
  LINE_WIDTH: {
    DEFAULT: 2,
    BACKBOARD: 4,
    RIM: 3,
  }
}

/**
 * Calculate where the 3-point arc meets the corner straight sections.
 * The corner 3 is a straight line 3 feet from the sideline.
 * The arc is 23.75 feet from the basket center.
 *
 * Returns the Y position (in feet from baseline) where the arc starts.
 */
export function getCornerThreeArcTransition() {
  const rimFromBaseline = NBA_COURT.RIM_FROM_BASELINE
  const arcRadius = NBA_COURT.THREE_POINT_ARC_RADIUS
  const cornerDist = NBA_COURT.CORNER_THREE_FROM_SIDELINE
  const courtHalfWidth = NBA_COURT.FULL_WIDTH / 2

  // Distance from rim center to the corner 3 line (horizontally)
  const horizontalDist = courtHalfWidth - cornerDist

  // Using Pythagorean theorem: arcRadius^2 = horizontalDist^2 + verticalDist^2
  // verticalDist = sqrt(arcRadius^2 - horizontalDist^2)
  const verticalDist = Math.sqrt(arcRadius * arcRadius - horizontalDist * horizontalDist)

  // The arc transition point is verticalDist above the rim, so from baseline:
  return rimFromBaseline + verticalDist
}

/**
 * Normalized position helpers for play creation.
 * These convert court positions (in feet) to normalized 0-1 coordinates.
 */
export const COURT_POSITIONS = {
  // Key positions (normalized X, Y)
  // Y: 0 = top of court, 1 = baseline

  // Basket area
  BASKET: { x: 0.5, y: 0.92 },

  // Key/Paint
  LEFT_BLOCK: { x: 0.34, y: 0.75 },
  RIGHT_BLOCK: { x: 0.66, y: 0.75 },
  LEFT_ELBOW: { x: 0.34, y: 0.45 },
  RIGHT_ELBOW: { x: 0.66, y: 0.45 },
  FREE_THROW: { x: 0.5, y: 0.45 },

  // Perimeter
  TOP_OF_KEY: { x: 0.5, y: 0.35 },
  LEFT_WING: { x: 0.18, y: 0.45 },
  RIGHT_WING: { x: 0.82, y: 0.45 },
  LEFT_CORNER: { x: 0.08, y: 0.85 },
  RIGHT_CORNER: { x: 0.92, y: 0.85 },

  // Deep positions
  TOP_OF_ARC: { x: 0.5, y: 0.15 },
  LEFT_SLOT: { x: 0.30, y: 0.25 },
  RIGHT_SLOT: { x: 0.70, y: 0.25 },
}

/**
 * Default player formations for different scenarios
 */
export const FORMATIONS = {
  // Standard offensive set (5-out spacing)
  FIVE_OUT: {
    PG: { x: 0.5, y: 0.20 },   // Top of arc
    SG: { x: 0.15, y: 0.40 },  // Left wing
    SF: { x: 0.85, y: 0.40 },  // Right wing
    PF: { x: 0.25, y: 0.70 },  // Left short corner
    C: { x: 0.75, y: 0.70 },   // Right short corner
  },

  // Horns set
  HORNS: {
    PG: { x: 0.5, y: 0.20 },
    SG: { x: 0.10, y: 0.75 },  // Left corner
    SF: { x: 0.90, y: 0.75 },  // Right corner
    PF: { x: 0.35, y: 0.42 },  // Left elbow
    C: { x: 0.65, y: 0.42 },   // Right elbow
  },

  // Traditional (2 bigs in post)
  TRADITIONAL: {
    PG: { x: 0.5, y: 0.25 },
    SG: { x: 0.15, y: 0.45 },
    SF: { x: 0.85, y: 0.45 },
    PF: { x: 0.35, y: 0.70 },
    C: { x: 0.65, y: 0.70 },
  }
}

export default {
  NBA_COURT,
  COURT_CANVAS,
  COURT_POSITIONS,
  FORMATIONS,
  getCornerThreeArcTransition,
}
