// ---------------------------------------------------------------------------
// Site config — edit this file to update the site. Everything else is layout.
// ---------------------------------------------------------------------------

export const SITE_CONFIG = {
  // The destructible text in the breakout game. One array entry per line.
  // Convention: the next concert I'm attending.
  // Supported characters: A-Z, 0-9, space, . , ! ' & / -
  marqueeLines: ['RUSH', 'TORONTO', 'AUGUST 11', '2026'],

  // Small caption shown above the game.
  marqueeCaption: "Have a quick break: play a game!",

  // Game tuning.
  game: {
    lives: 3,
    // Difficulty modes (legend toggle). Laptop = trackpad-friendly slower
    // ball; desktop = full speed. Stats aggregate within a mode only.
    ballSpeeds: { laptop: 540, desktop: 720 },
    // Board size the ballSpeeds were tuned on. Smaller viewports (13"
    // laptops) get a proportionally slower ball so the time the ball takes
    // to cross the board — i.e. your reaction time — is the same on every
    // screen. See scaleSpeedToBoard in engine.js for the clamp.
    speedRefBoard: { width: 1480, height: 930 },
    // Seconds allowed between brick hits before the combo multiplier
    // resets to 1X. Hits inside the window climb 1X→2X→3X→…→10X.
    // Needs to exceed the ball's brick→paddle travel time (~1s at
    // BALL_SPEED 690) or the paddle is back to full size every return.
    comboWindow: 1.7,
    brickPoints: 10,
  },

  // "Current interesting AI item" slot in the left pane.
  aiItem: {
    label: 'Laukkonen, R. et al. Contemplative Superalignment',
    url: 'https://www.researchgate.net/publication/394347277_Contemplative_Superalignment',
    note: `Fascinated by this work discussing how Friston's Active Inference framework might be extended to provide avenues into 
    utilizing wisdom approaches (e.g. Buddhist meditative/compassion methods) for much more effective AI alignment strategies. What an amazing
    research domain!`,
  },
};
