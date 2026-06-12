// ---------------------------------------------------------------------------
// Site config — edit this file to update the site. Everything else is layout.
// ---------------------------------------------------------------------------

export const SITE_CONFIG = {
  // The destructible text in the breakout game. One array entry per line.
  // Convention: the next concert I'm attending.
  // Supported characters: A-Z, 0-9, space, . , ! ' & / -
  marqueeLines: ['RUSH', 'TORONTO', 'AUGUST 11', '2026'],

  // Small caption shown above the game.
  marqueeCaption: "Next Concert I'll be attending. Break it gently.",

  // Game tuning.
  game: {
    lives: 3,
    // Difficulty modes (legend toggle). Laptop = trackpad-friendly slower
    // ball; desktop = full speed. Stats aggregate within a mode only.
    ballSpeeds: { laptop: 540, desktop: 720 },
    // Seconds allowed between brick hits before the combo multiplier
    // resets to 1X. Hits inside the window climb 1X→2X→3X→…→10X.
    // Needs to exceed the ball's brick→paddle travel time (~1s at
    // BALL_SPEED 690) or the paddle is back to full size every return.
    comboWindow: 1.7,
    brickPoints: 10,
  },

  // "Current interesting AI item" slot in the left pane.
  aiItem: {
    label: 'Hermes Harness Architecture',
    url: 'https://x.com/aparnadhinak/status/2060406977357070522',
    note: 'Instructive breakdown... lots to grok.',
  },
};
