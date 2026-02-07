// Master plays database for basketball simulation
// Total plays: 8

export const playsMaster = [
  {
    "id": "pick-and-roll-basic",
    "name": "Basic Pick and Roll",
    "category": "pick_and_roll",
    "difficulty": 55,
    "tempo": "halfcourt",
    "primaryPositions": ["PG", "SG"],
    "tags": ["screen", "two_man_game", "versatile"],
    "formation": {
      "ballHandler": { "x": 0.5, "y": 0.15 },
      "screener": { "x": 0.5, "y": 0.35 },
      "wing1": { "x": 0.15, "y": 0.25 },
      "wing2": { "x": 0.85, "y": 0.25 },
      "corner": { "x": 0.85, "y": 0.75 }
    },
    "roles": {
      "ballHandler": ["PG", "SG", "SF"],
      "screener": ["C", "PF"],
      "wing1": ["SF", "SG"],
      "wing2": ["SG", "SF"],
      "corner": ["PF", "SF", "SG"]
    },
    "actions": [
      {
        "id": "screen_set",
        "type": "screen",
        "duration": 1.5,
        "actor": "screener",
        "target": "ballHandler",
        "movement": { "screener": { "x": 0.45, "y": 0.28 } },
        "attributes": { "offense": ["strength"], "defense": ["perimeterDefense", "helpDefenseIQ"] },
        "outcomes": {
          "success": { "next": "drive_decision", "probability": 0.7 },
          "hedge": { "next": "drive_decision", "modifier": -0.15 },
          "switch": { "next": "drive_decision", "probability": 0.2 }
        }
      },
      {
        "id": "drive_decision",
        "type": "decision",
        "duration": 0.5,
        "actor": "ballHandler",
        "movement": { "ballHandler": { "x": 0.45, "y": 0.35 } },
        "attributes": { "offense": ["passVision"], "defense": ["helpDefenseIQ"] },
        "outcomes": {
          "drive": { "next": "drive_to_rim", "probability": 0.4 },
          "pull_up": { "next": "pull_up_jumper", "probability": 0.25 },
          "pocket_pass": { "next": "roll_pass", "probability": 0.35 }
        }
      },
      {
        "id": "drive_to_rim",
        "type": "drive",
        "duration": 1.2,
        "actor": "ballHandler",
        "movement": { "ballHandler": { "x": 0.5, "y": 0.75 }, "screener": { "x": 0.35, "y": 0.65 } },
        "attributes": { "offense": ["speedWithBall", "layup", "drivingDunk"], "defense": ["interiorDefense", "block"] },
        "outcomes": {
          "finish": { "next": "finish_at_rim", "probability": 0.6 },
          "kick_out": { "next": "kick_out_three", "probability": 0.3 },
          "turnover": { "next": "end_turnover", "probability": 0.1 }
        }
      },
      {
        "id": "roll_pass",
        "type": "pass",
        "duration": 0.8,
        "actor": "ballHandler",
        "receiver": "screener",
        "movement": { "screener": { "x": 0.5, "y": 0.75 } },
        "attributes": { "offense": ["passAccuracy", "passIQ"], "defense": ["passPerception", "steal"] },
        "outcomes": {
          "success": { "next": "finish_at_rim", "probability": 0.75 },
          "stolen": { "next": "end_turnover", "probability": 0.25 }
        }
      },
      {
        "id": "finish_at_rim",
        "type": "shot",
        "duration": 0.6,
        "shotType": "paint",
        "actor": "dynamic",
        "movement": { "dynamic": { "x": 0.5, "y": 0.85 } },
        "attributes": { "offense": ["closeShot", "layup"], "defense": ["interiorDefense", "block"] },
        "outcomes": {
          "made": { "next": "end_made", "points": 2 },
          "missed": { "next": "rebound_battle" },
          "fouled": { "next": "free_throws", "probability": 0.15 }
        }
      },
      {
        "id": "pull_up_jumper",
        "type": "shot",
        "duration": 0.8,
        "shotType": "midRange",
        "actor": "ballHandler",
        "movement": { "ballHandler": { "x": 0.45, "y": 0.45 } },
        "attributes": { "offense": ["midRange", "shotIQ"], "defense": ["perimeterDefense"] },
        "outcomes": {
          "made": { "next": "end_made", "points": 2 },
          "missed": { "next": "rebound_battle" }
        }
      },
      {
        "id": "kick_out_three",
        "type": "pass",
        "duration": 0.6,
        "actor": "ballHandler",
        "receiver": "wing2",
        "attributes": { "offense": ["passAccuracy"], "defense": ["closeout"] },
        "outcomes": {
          "success": { "next": "catch_and_shoot" },
          "stolen": { "next": "end_turnover", "probability": 0.1 }
        }
      },
      {
        "id": "catch_and_shoot",
        "type": "shot",
        "duration": 0.7,
        "shotType": "threePoint",
        "actor": "wing2",
        "attributes": { "offense": ["threePoint", "offensiveConsistency"], "defense": ["perimeterDefense"] },
        "outcomes": {
          "made": { "next": "end_made", "points": 3 },
          "missed": { "next": "rebound_battle" }
        }
      }
    ],
    "badgeEffects": {
      "screen_set": ["brick_wall", "pick_dodger"],
      "drive_to_rim": ["slithery_finisher", "contact_finisher"],
      "pull_up_jumper": ["difficult_shots", "deadeye"],
      "catch_and_shoot": ["catch_and_shoot", "corner_specialist"]
    }
  },
  {
    "id": "isolation-wing",
    "name": "Wing Isolation",
    "category": "isolation",
    "difficulty": 60,
    "tempo": "halfcourt",
    "primaryPositions": ["SF", "SG"],
    "tags": ["iso", "one_on_one", "scoring"],
    "formation": {
      "ballHandler": { "x": 0.25, "y": 0.35 },
      "post": { "x": 0.7, "y": 0.6 },
      "weakWing": { "x": 0.85, "y": 0.25 },
      "corner1": { "x": 0.15, "y": 0.75 },
      "corner2": { "x": 0.85, "y": 0.75 }
    },
    "roles": {
      "ballHandler": ["SF", "SG", "PG"],
      "post": ["C", "PF"],
      "weakWing": ["SG", "SF"],
      "corner1": ["PF", "SF"],
      "corner2": ["SG", "SF"]
    },
    "actions": [
      {
        "id": "iso_setup",
        "type": "setup",
        "duration": 1.0,
        "actor": "ballHandler",
        "movement": { "ballHandler": { "x": 0.25, "y": 0.4 } },
        "attributes": { "offense": ["ballHandling"], "defense": ["perimeterDefense"] },
        "outcomes": {
          "attack": { "next": "iso_attack", "probability": 1.0 }
        }
      },
      {
        "id": "iso_attack",
        "type": "drive",
        "duration": 1.5,
        "actor": "ballHandler",
        "movement": { "ballHandler": { "x": 0.4, "y": 0.55 } },
        "attributes": { "offense": ["ballHandling", "speedWithBall"], "defense": ["perimeterDefense", "steal"] },
        "outcomes": {
          "beat_defender": { "next": "drive_finish", "probability": 0.45 },
          "step_back": { "next": "step_back_jumper", "probability": 0.3 },
          "pass_out": { "next": "kick_corner", "probability": 0.15 },
          "turnover": { "next": "end_turnover", "probability": 0.1 }
        }
      },
      {
        "id": "drive_finish",
        "type": "shot",
        "duration": 1.0,
        "shotType": "paint",
        "actor": "ballHandler",
        "movement": { "ballHandler": { "x": 0.5, "y": 0.8 } },
        "attributes": { "offense": ["layup", "drivingDunk", "drawFoul"], "defense": ["interiorDefense", "block", "helpDefenseIQ"] },
        "outcomes": {
          "made": { "next": "end_made", "points": 2 },
          "missed": { "next": "rebound_battle" },
          "fouled": { "next": "free_throws", "probability": 0.2 }
        }
      },
      {
        "id": "step_back_jumper",
        "type": "shot",
        "duration": 0.8,
        "shotType": "midRange",
        "actor": "ballHandler",
        "movement": { "ballHandler": { "x": 0.35, "y": 0.45 } },
        "attributes": { "offense": ["midRange", "shotIQ"], "defense": ["perimeterDefense"] },
        "outcomes": {
          "made": { "next": "end_made", "points": 2 },
          "missed": { "next": "rebound_battle" }
        }
      },
      {
        "id": "kick_corner",
        "type": "pass",
        "duration": 0.5,
        "actor": "ballHandler",
        "receiver": "corner1",
        "attributes": { "offense": ["passAccuracy"], "defense": ["closeout"] },
        "outcomes": {
          "success": { "next": "corner_three" },
          "stolen": { "next": "end_turnover", "probability": 0.1 }
        }
      },
      {
        "id": "corner_three",
        "type": "shot",
        "duration": 0.7,
        "shotType": "threePoint",
        "actor": "corner1",
        "attributes": { "offense": ["threePoint"], "defense": ["perimeterDefense"] },
        "outcomes": {
          "made": { "next": "end_made", "points": 3 },
          "missed": { "next": "rebound_battle" }
        }
      }
    ],
    "badgeEffects": {
      "iso_attack": ["ankle_breaker", "tight_handles"],
      "drive_finish": ["slithery_finisher", "contact_finisher"],
      "step_back_jumper": ["difficult_shots", "space_creator"]
    }
  },
  {
    "id": "post-up-low",
    "name": "Low Post Up",
    "category": "post_up",
    "difficulty": 50,
    "tempo": "halfcourt",
    "primaryPositions": ["C", "PF"],
    "tags": ["post", "inside", "big_man"],
    "formation": {
      "postPlayer": { "x": 0.35, "y": 0.65 },
      "pointGuard": { "x": 0.5, "y": 0.15 },
      "wing1": { "x": 0.15, "y": 0.3 },
      "wing2": { "x": 0.85, "y": 0.3 },
      "weakSide": { "x": 0.85, "y": 0.65 }
    },
    "roles": {
      "postPlayer": ["C", "PF"],
      "pointGuard": ["PG", "SG"],
      "wing1": ["SF", "SG"],
      "wing2": ["SG", "SF"],
      "weakSide": ["PF", "SF"]
    },
    "actions": [
      {
        "id": "entry_pass",
        "type": "pass",
        "duration": 1.0,
        "actor": "pointGuard",
        "receiver": "postPlayer",
        "movement": { "postPlayer": { "x": 0.35, "y": 0.7 } },
        "attributes": { "offense": ["passAccuracy"], "defense": ["passPerception", "steal"] },
        "outcomes": {
          "success": { "next": "post_moves", "probability": 0.85 },
          "stolen": { "next": "end_turnover", "probability": 0.15 }
        }
      },
      {
        "id": "post_moves",
        "type": "post",
        "duration": 2.0,
        "actor": "postPlayer",
        "movement": { "postPlayer": { "x": 0.4, "y": 0.75 } },
        "attributes": { "offense": ["postControl", "strength"], "defense": ["interiorDefense", "strength"] },
        "outcomes": {
          "hook_shot": { "next": "post_hook", "probability": 0.35 },
          "fade_away": { "next": "post_fade", "probability": 0.25 },
          "drop_step": { "next": "post_dunk", "probability": 0.25 },
          "kick_out": { "next": "kick_out_wing", "probability": 0.15 }
        }
      },
      {
        "id": "post_hook",
        "type": "shot",
        "duration": 0.8,
        "shotType": "paint",
        "actor": "postPlayer",
        "movement": { "postPlayer": { "x": 0.45, "y": 0.8 } },
        "attributes": { "offense": ["postHook", "closeShot"], "defense": ["interiorDefense", "block"] },
        "outcomes": {
          "made": { "next": "end_made", "points": 2 },
          "missed": { "next": "rebound_battle" }
        }
      },
      {
        "id": "post_fade",
        "type": "shot",
        "duration": 0.9,
        "shotType": "midRange",
        "actor": "postPlayer",
        "movement": { "postPlayer": { "x": 0.3, "y": 0.7 } },
        "attributes": { "offense": ["postFade", "midRange"], "defense": ["interiorDefense"] },
        "outcomes": {
          "made": { "next": "end_made", "points": 2 },
          "missed": { "next": "rebound_battle" }
        }
      },
      {
        "id": "post_dunk",
        "type": "shot",
        "duration": 0.6,
        "shotType": "paint",
        "actor": "postPlayer",
        "movement": { "postPlayer": { "x": 0.5, "y": 0.85 } },
        "attributes": { "offense": ["standingDunk", "strength"], "defense": ["interiorDefense", "block"] },
        "outcomes": {
          "made": { "next": "end_made", "points": 2 },
          "missed": { "next": "rebound_battle" },
          "fouled": { "next": "free_throws", "probability": 0.25 }
        }
      },
      {
        "id": "kick_out_wing",
        "type": "pass",
        "duration": 0.6,
        "actor": "postPlayer",
        "receiver": "wing2",
        "attributes": { "offense": ["passAccuracy", "passVision"], "defense": ["closeout"] },
        "outcomes": {
          "success": { "next": "wing_three" },
          "stolen": { "next": "end_turnover", "probability": 0.1 }
        }
      },
      {
        "id": "wing_three",
        "type": "shot",
        "duration": 0.7,
        "shotType": "threePoint",
        "actor": "wing2",
        "attributes": { "offense": ["threePoint"], "defense": ["perimeterDefense"] },
        "outcomes": {
          "made": { "next": "end_made", "points": 3 },
          "missed": { "next": "rebound_battle" }
        }
      }
    ],
    "badgeEffects": {
      "post_moves": ["post_spin_technician", "backdown_punisher"],
      "post_hook": ["hook_specialist"],
      "post_fade": ["fade_ace"],
      "post_dunk": ["posterizer", "rise_up"]
    }
  },
  {
    "id": "fast-break-3on2",
    "name": "3-on-2 Fast Break",
    "category": "transition",
    "difficulty": 40,
    "tempo": "fastbreak",
    "primaryPositions": ["PG", "SG", "SF"],
    "tags": ["transition", "fast", "easy_basket"],
    "formation": {
      "ballHandler": { "x": 0.5, "y": 0.1 },
      "trailer1": { "x": 0.25, "y": 0.15 },
      "trailer2": { "x": 0.75, "y": 0.15 },
      "rim_runner": { "x": 0.5, "y": 0.5 },
      "safety": { "x": 0.5, "y": 0.05 }
    },
    "roles": {
      "ballHandler": ["PG", "SG", "SF"],
      "trailer1": ["SG", "SF"],
      "trailer2": ["SF", "SG"],
      "rim_runner": ["C", "PF"],
      "safety": ["PF", "C"]
    },
    "actions": [
      {
        "id": "push_ball",
        "type": "drive",
        "duration": 2.0,
        "actor": "ballHandler",
        "movement": {
          "ballHandler": { "x": 0.5, "y": 0.5 },
          "trailer1": { "x": 0.2, "y": 0.4 },
          "trailer2": { "x": 0.8, "y": 0.4 }
        },
        "attributes": { "offense": ["speed", "ballHandling"], "defense": ["speed"] },
        "outcomes": {
          "numbers": { "next": "attack_rim", "probability": 0.7 },
          "pull_up": { "next": "transition_three", "probability": 0.2 },
          "turnover": { "next": "end_turnover", "probability": 0.1 }
        }
      },
      {
        "id": "attack_rim",
        "type": "decision",
        "duration": 0.5,
        "actor": "ballHandler",
        "movement": { "ballHandler": { "x": 0.5, "y": 0.65 } },
        "attributes": { "offense": ["passVision"], "defense": ["helpDefenseIQ"] },
        "outcomes": {
          "finish": { "next": "layup_finish", "probability": 0.5 },
          "dish_left": { "next": "trailer_layup_left", "probability": 0.25 },
          "dish_right": { "next": "trailer_layup_right", "probability": 0.25 }
        }
      },
      {
        "id": "layup_finish",
        "type": "shot",
        "duration": 0.8,
        "shotType": "paint",
        "actor": "ballHandler",
        "movement": { "ballHandler": { "x": 0.5, "y": 0.85 } },
        "attributes": { "offense": ["layup", "speedWithBall"], "defense": ["block"] },
        "outcomes": {
          "made": { "next": "end_made", "points": 2 },
          "missed": { "next": "rebound_battle" },
          "fouled": { "next": "free_throws", "probability": 0.2 }
        }
      },
      {
        "id": "trailer_layup_left",
        "type": "pass",
        "duration": 0.4,
        "actor": "ballHandler",
        "receiver": "trailer1",
        "movement": { "trailer1": { "x": 0.35, "y": 0.75 } },
        "attributes": { "offense": ["passAccuracy"], "defense": ["steal"] },
        "outcomes": {
          "success": { "next": "finish_trailer", "probability": 0.9 },
          "stolen": { "next": "end_turnover", "probability": 0.1 }
        }
      },
      {
        "id": "trailer_layup_right",
        "type": "pass",
        "duration": 0.4,
        "actor": "ballHandler",
        "receiver": "trailer2",
        "movement": { "trailer2": { "x": 0.65, "y": 0.75 } },
        "attributes": { "offense": ["passAccuracy"], "defense": ["steal"] },
        "outcomes": {
          "success": { "next": "finish_trailer", "probability": 0.9 },
          "stolen": { "next": "end_turnover", "probability": 0.1 }
        }
      },
      {
        "id": "finish_trailer",
        "type": "shot",
        "duration": 0.6,
        "shotType": "paint",
        "actor": "dynamic",
        "movement": { "dynamic": { "x": 0.5, "y": 0.85 } },
        "attributes": { "offense": ["layup"], "defense": ["block"] },
        "outcomes": {
          "made": { "next": "end_made", "points": 2 },
          "missed": { "next": "rebound_battle" }
        }
      },
      {
        "id": "transition_three",
        "type": "shot",
        "duration": 0.7,
        "shotType": "threePoint",
        "actor": "ballHandler",
        "movement": { "ballHandler": { "x": 0.5, "y": 0.25 } },
        "attributes": { "offense": ["threePoint"], "defense": ["closeout"] },
        "outcomes": {
          "made": { "next": "end_made", "points": 3 },
          "missed": { "next": "rebound_battle" }
        }
      }
    ],
    "badgeEffects": {
      "push_ball": ["downhill", "quick_first_step"],
      "layup_finish": ["acrobat", "pro_touch"],
      "transition_three": ["limitless_range"]
    }
  },
  {
    "id": "motion-flex",
    "name": "Flex Motion",
    "category": "motion",
    "difficulty": 70,
    "tempo": "halfcourt",
    "primaryPositions": ["PG"],
    "tags": ["motion", "screens", "team_play"],
    "formation": {
      "point": { "x": 0.5, "y": 0.15 },
      "wing1": { "x": 0.15, "y": 0.35 },
      "wing2": { "x": 0.85, "y": 0.35 },
      "block1": { "x": 0.3, "y": 0.75 },
      "block2": { "x": 0.7, "y": 0.75 }
    },
    "roles": {
      "point": ["PG", "SG"],
      "wing1": ["SF", "SG"],
      "wing2": ["SG", "SF"],
      "block1": ["PF", "C"],
      "block2": ["C", "PF"]
    },
    "actions": [
      {
        "id": "flex_screen",
        "type": "screen",
        "duration": 1.5,
        "actor": "block1",
        "target": "block2",
        "movement": {
          "block2": { "x": 0.35, "y": 0.7 },
          "block1": { "x": 0.5, "y": 0.8 }
        },
        "attributes": { "offense": ["strength"], "defense": ["helpDefenseIQ"] },
        "outcomes": {
          "cutter_open": { "next": "flex_cut_pass", "probability": 0.5 },
          "screener_open": { "next": "down_screen", "probability": 0.5 }
        }
      },
      {
        "id": "flex_cut_pass",
        "type": "pass",
        "duration": 0.6,
        "actor": "wing1",
        "receiver": "block2",
        "movement": { "block2": { "x": 0.4, "y": 0.8 } },
        "attributes": { "offense": ["passAccuracy", "passVision"], "defense": ["steal", "passPerception"] },
        "outcomes": {
          "success": { "next": "flex_layup", "probability": 0.8 },
          "stolen": { "next": "end_turnover", "probability": 0.2 }
        }
      },
      {
        "id": "flex_layup",
        "type": "shot",
        "duration": 0.6,
        "shotType": "paint",
        "actor": "block2",
        "movement": { "block2": { "x": 0.5, "y": 0.85 } },
        "attributes": { "offense": ["layup", "closeShot"], "defense": ["interiorDefense", "block"] },
        "outcomes": {
          "made": { "next": "end_made", "points": 2 },
          "missed": { "next": "rebound_battle" }
        }
      },
      {
        "id": "down_screen",
        "type": "screen",
        "duration": 1.2,
        "actor": "block2",
        "target": "wing2",
        "movement": {
          "wing2": { "x": 0.7, "y": 0.5 },
          "block2": { "x": 0.75, "y": 0.6 }
        },
        "attributes": { "offense": ["strength"], "defense": ["perimeterDefense"] },
        "outcomes": {
          "shooter_open": { "next": "wing_catch_shoot", "probability": 0.6 },
          "curl_drive": { "next": "curl_to_rim", "probability": 0.4 }
        }
      },
      {
        "id": "wing_catch_shoot",
        "type": "shot",
        "duration": 0.7,
        "shotType": "threePoint",
        "actor": "wing2",
        "attributes": { "offense": ["threePoint", "offensiveConsistency"], "defense": ["perimeterDefense", "closeout"] },
        "outcomes": {
          "made": { "next": "end_made", "points": 3 },
          "missed": { "next": "rebound_battle" }
        }
      },
      {
        "id": "curl_to_rim",
        "type": "drive",
        "duration": 1.0,
        "actor": "wing2",
        "movement": { "wing2": { "x": 0.55, "y": 0.75 } },
        "attributes": { "offense": ["speedWithBall", "layup"], "defense": ["helpDefenseIQ", "block"] },
        "outcomes": {
          "finish": { "next": "curl_finish", "probability": 0.7 },
          "turnover": { "next": "end_turnover", "probability": 0.3 }
        }
      },
      {
        "id": "curl_finish",
        "type": "shot",
        "duration": 0.6,
        "shotType": "paint",
        "actor": "wing2",
        "movement": { "wing2": { "x": 0.5, "y": 0.85 } },
        "attributes": { "offense": ["layup"], "defense": ["block"] },
        "outcomes": {
          "made": { "next": "end_made", "points": 2 },
          "missed": { "next": "rebound_battle" }
        }
      }
    ],
    "badgeEffects": {
      "flex_screen": ["brick_wall"],
      "flex_layup": ["pro_touch"],
      "wing_catch_shoot": ["catch_and_shoot"]
    }
  },
  {
    "id": "spot-up-corner",
    "name": "Corner Spot Up",
    "category": "spot_up",
    "difficulty": 45,
    "tempo": "halfcourt",
    "primaryPositions": ["SG", "SF"],
    "tags": ["three_point", "catch_shoot", "spacing"],
    "formation": {
      "shooter": { "x": 0.1, "y": 0.75 },
      "ballHandler": { "x": 0.5, "y": 0.2 },
      "screener": { "x": 0.6, "y": 0.4 },
      "wing": { "x": 0.85, "y": 0.35 },
      "post": { "x": 0.7, "y": 0.7 }
    },
    "roles": {
      "shooter": ["SG", "SF", "PF"],
      "ballHandler": ["PG", "SG"],
      "screener": ["C", "PF"],
      "wing": ["SF", "SG"],
      "post": ["PF", "C"]
    },
    "actions": [
      {
        "id": "drive_and_kick",
        "type": "drive",
        "duration": 1.5,
        "actor": "ballHandler",
        "movement": { "ballHandler": { "x": 0.4, "y": 0.5 } },
        "attributes": { "offense": ["speedWithBall", "passVision"], "defense": ["perimeterDefense", "helpDefenseIQ"] },
        "outcomes": {
          "kick_corner": { "next": "corner_pass", "probability": 0.6 },
          "finish": { "next": "floater", "probability": 0.3 },
          "turnover": { "next": "end_turnover", "probability": 0.1 }
        }
      },
      {
        "id": "corner_pass",
        "type": "pass",
        "duration": 0.5,
        "actor": "ballHandler",
        "receiver": "shooter",
        "attributes": { "offense": ["passAccuracy"], "defense": ["closeout"] },
        "outcomes": {
          "success": { "next": "corner_three", "probability": 0.9 },
          "stolen": { "next": "end_turnover", "probability": 0.1 }
        }
      },
      {
        "id": "corner_three",
        "type": "shot",
        "duration": 0.7,
        "shotType": "threePoint",
        "actor": "shooter",
        "attributes": { "offense": ["threePoint", "offensiveConsistency"], "defense": ["perimeterDefense", "closeout"] },
        "outcomes": {
          "made": { "next": "end_made", "points": 3 },
          "missed": { "next": "rebound_battle" }
        }
      },
      {
        "id": "floater",
        "type": "shot",
        "duration": 0.6,
        "shotType": "paint",
        "actor": "ballHandler",
        "movement": { "ballHandler": { "x": 0.45, "y": 0.65 } },
        "attributes": { "offense": ["closeShot", "layup"], "defense": ["interiorDefense"] },
        "outcomes": {
          "made": { "next": "end_made", "points": 2 },
          "missed": { "next": "rebound_battle" }
        }
      }
    ],
    "badgeEffects": {
      "corner_three": ["corner_specialist", "catch_and_shoot"],
      "floater": ["floater_specialist", "tear_dropper"]
    }
  },
  {
    "id": "back-cut",
    "name": "Back Door Cut",
    "category": "cut",
    "difficulty": 55,
    "tempo": "halfcourt",
    "primaryPositions": ["SF", "SG"],
    "tags": ["cut", "layup", "read_defense"],
    "formation": {
      "cutter": { "x": 0.15, "y": 0.35 },
      "passer": { "x": 0.5, "y": 0.15 },
      "spacer1": { "x": 0.85, "y": 0.35 },
      "spacer2": { "x": 0.25, "y": 0.7 },
      "spacer3": { "x": 0.75, "y": 0.7 }
    },
    "roles": {
      "cutter": ["SF", "SG", "PF"],
      "passer": ["PG", "SG"],
      "spacer1": ["SG", "SF"],
      "spacer2": ["PF", "SF"],
      "spacer3": ["C", "PF"]
    },
    "actions": [
      {
        "id": "setup_cut",
        "type": "setup",
        "duration": 1.0,
        "actor": "cutter",
        "movement": { "cutter": { "x": 0.2, "y": 0.3 } },
        "attributes": { "offense": ["speed"], "defense": ["perimeterDefense"] },
        "outcomes": {
          "defender_overplays": { "next": "back_cut", "probability": 0.6 },
          "defender_sags": { "next": "catch_and_attack", "probability": 0.4 }
        }
      },
      {
        "id": "back_cut",
        "type": "cut",
        "duration": 1.2,
        "actor": "cutter",
        "movement": { "cutter": { "x": 0.4, "y": 0.75 } },
        "attributes": { "offense": ["speed", "acceleration"], "defense": ["helpDefenseIQ"] },
        "outcomes": {
          "open": { "next": "back_cut_pass", "probability": 0.7 },
          "covered": { "next": "reset_offense", "probability": 0.3 }
        }
      },
      {
        "id": "back_cut_pass",
        "type": "pass",
        "duration": 0.5,
        "actor": "passer",
        "receiver": "cutter",
        "movement": { "cutter": { "x": 0.5, "y": 0.8 } },
        "attributes": { "offense": ["passAccuracy", "passVision"], "defense": ["steal", "passPerception"] },
        "outcomes": {
          "success": { "next": "cut_layup", "probability": 0.8 },
          "stolen": { "next": "end_turnover", "probability": 0.2 }
        }
      },
      {
        "id": "cut_layup",
        "type": "shot",
        "duration": 0.6,
        "shotType": "paint",
        "actor": "cutter",
        "movement": { "cutter": { "x": 0.5, "y": 0.85 } },
        "attributes": { "offense": ["layup", "hands"], "defense": ["block"] },
        "outcomes": {
          "made": { "next": "end_made", "points": 2 },
          "missed": { "next": "rebound_battle" },
          "fouled": { "next": "free_throws", "probability": 0.15 }
        }
      },
      {
        "id": "catch_and_attack",
        "type": "pass",
        "duration": 0.6,
        "actor": "passer",
        "receiver": "cutter",
        "movement": { "cutter": { "x": 0.25, "y": 0.4 } },
        "attributes": { "offense": ["passAccuracy"], "defense": ["steal"] },
        "outcomes": {
          "success": { "next": "wing_attack", "probability": 0.9 },
          "stolen": { "next": "end_turnover", "probability": 0.1 }
        }
      },
      {
        "id": "wing_attack",
        "type": "drive",
        "duration": 1.0,
        "actor": "cutter",
        "movement": { "cutter": { "x": 0.4, "y": 0.6 } },
        "attributes": { "offense": ["ballHandling", "speedWithBall"], "defense": ["perimeterDefense"] },
        "outcomes": {
          "finish": { "next": "attack_layup", "probability": 0.5 },
          "pull_up": { "next": "wing_jumper", "probability": 0.35 },
          "turnover": { "next": "end_turnover", "probability": 0.15 }
        }
      },
      {
        "id": "attack_layup",
        "type": "shot",
        "duration": 0.7,
        "shotType": "paint",
        "actor": "cutter",
        "movement": { "cutter": { "x": 0.5, "y": 0.8 } },
        "attributes": { "offense": ["layup", "drivingDunk"], "defense": ["interiorDefense", "block"] },
        "outcomes": {
          "made": { "next": "end_made", "points": 2 },
          "missed": { "next": "rebound_battle" }
        }
      },
      {
        "id": "wing_jumper",
        "type": "shot",
        "duration": 0.7,
        "shotType": "midRange",
        "actor": "cutter",
        "attributes": { "offense": ["midRange"], "defense": ["perimeterDefense"] },
        "outcomes": {
          "made": { "next": "end_made", "points": 2 },
          "missed": { "next": "rebound_battle" }
        }
      },
      {
        "id": "reset_offense",
        "type": "reset",
        "duration": 2.0,
        "actor": "passer",
        "outcomes": {
          "new_action": { "next": "catch_and_attack", "probability": 1.0 }
        }
      }
    ],
    "badgeEffects": {
      "back_cut": ["lob_city_finisher"],
      "cut_layup": ["acrobat", "pro_touch"]
    }
  },
  {
    "id": "horns-set",
    "name": "Horns Set",
    "category": "motion",
    "difficulty": 65,
    "tempo": "halfcourt",
    "primaryPositions": ["PG"],
    "tags": ["versatile", "options", "spacing"],
    "formation": {
      "point": { "x": 0.5, "y": 0.15 },
      "elbow1": { "x": 0.35, "y": 0.4 },
      "elbow2": { "x": 0.65, "y": 0.4 },
      "corner1": { "x": 0.1, "y": 0.75 },
      "corner2": { "x": 0.9, "y": 0.75 }
    },
    "roles": {
      "point": ["PG", "SG"],
      "elbow1": ["PF", "C"],
      "elbow2": ["C", "PF"],
      "corner1": ["SF", "SG"],
      "corner2": ["SG", "SF"]
    },
    "actions": [
      {
        "id": "horns_entry",
        "type": "decision",
        "duration": 1.0,
        "actor": "point",
        "movement": { "point": { "x": 0.5, "y": 0.25 } },
        "attributes": { "offense": ["passVision"], "defense": ["perimeterDefense"] },
        "outcomes": {
          "pnr_left": { "next": "horns_pnr_left", "probability": 0.4 },
          "pnr_right": { "next": "horns_pnr_right", "probability": 0.4 },
          "dho": { "next": "dribble_handoff", "probability": 0.2 }
        }
      },
      {
        "id": "horns_pnr_left",
        "type": "screen",
        "duration": 1.3,
        "actor": "elbow1",
        "target": "point",
        "movement": {
          "point": { "x": 0.3, "y": 0.35 },
          "elbow1": { "x": 0.25, "y": 0.4 }
        },
        "attributes": { "offense": ["strength"], "defense": ["perimeterDefense", "helpDefenseIQ"] },
        "outcomes": {
          "drive": { "next": "horns_drive", "probability": 0.5 },
          "pop": { "next": "elbow_pop", "probability": 0.3 },
          "roll": { "next": "elbow_roll", "probability": 0.2 }
        }
      },
      {
        "id": "horns_pnr_right",
        "type": "screen",
        "duration": 1.3,
        "actor": "elbow2",
        "target": "point",
        "movement": {
          "point": { "x": 0.7, "y": 0.35 },
          "elbow2": { "x": 0.75, "y": 0.4 }
        },
        "attributes": { "offense": ["strength"], "defense": ["perimeterDefense", "helpDefenseIQ"] },
        "outcomes": {
          "drive": { "next": "horns_drive", "probability": 0.5 },
          "pop": { "next": "elbow_pop", "probability": 0.3 },
          "roll": { "next": "elbow_roll", "probability": 0.2 }
        }
      },
      {
        "id": "horns_drive",
        "type": "drive",
        "duration": 1.0,
        "actor": "point",
        "movement": { "point": { "x": 0.5, "y": 0.7 } },
        "attributes": { "offense": ["speedWithBall", "layup"], "defense": ["helpDefenseIQ", "block"] },
        "outcomes": {
          "finish": { "next": "horns_finish", "probability": 0.5 },
          "kick": { "next": "kick_corner_horns", "probability": 0.4 },
          "turnover": { "next": "end_turnover", "probability": 0.1 }
        }
      },
      {
        "id": "horns_finish",
        "type": "shot",
        "duration": 0.6,
        "shotType": "paint",
        "actor": "point",
        "movement": { "point": { "x": 0.5, "y": 0.85 } },
        "attributes": { "offense": ["layup", "closeShot"], "defense": ["interiorDefense", "block"] },
        "outcomes": {
          "made": { "next": "end_made", "points": 2 },
          "missed": { "next": "rebound_battle" }
        }
      },
      {
        "id": "elbow_pop",
        "type": "pass",
        "duration": 0.6,
        "actor": "point",
        "receiver": "elbow1",
        "movement": { "elbow1": { "x": 0.25, "y": 0.3 } },
        "attributes": { "offense": ["passAccuracy"], "defense": ["closeout"] },
        "outcomes": {
          "success": { "next": "elbow_three", "probability": 0.9 },
          "stolen": { "next": "end_turnover", "probability": 0.1 }
        }
      },
      {
        "id": "elbow_three",
        "type": "shot",
        "duration": 0.8,
        "shotType": "threePoint",
        "actor": "elbow1",
        "attributes": { "offense": ["threePoint", "midRange"], "defense": ["perimeterDefense"] },
        "outcomes": {
          "made": { "next": "end_made", "points": 3 },
          "missed": { "next": "rebound_battle" }
        }
      },
      {
        "id": "elbow_roll",
        "type": "pass",
        "duration": 0.6,
        "actor": "point",
        "receiver": "elbow1",
        "movement": { "elbow1": { "x": 0.4, "y": 0.75 } },
        "attributes": { "offense": ["passAccuracy", "passVision"], "defense": ["passPerception"] },
        "outcomes": {
          "success": { "next": "roll_finish", "probability": 0.75 },
          "stolen": { "next": "end_turnover", "probability": 0.25 }
        }
      },
      {
        "id": "roll_finish",
        "type": "shot",
        "duration": 0.6,
        "shotType": "paint",
        "actor": "elbow1",
        "movement": { "elbow1": { "x": 0.5, "y": 0.85 } },
        "attributes": { "offense": ["closeShot", "layup"], "defense": ["interiorDefense", "block"] },
        "outcomes": {
          "made": { "next": "end_made", "points": 2 },
          "missed": { "next": "rebound_battle" }
        }
      },
      {
        "id": "kick_corner_horns",
        "type": "pass",
        "duration": 0.5,
        "actor": "point",
        "receiver": "corner1",
        "attributes": { "offense": ["passAccuracy"], "defense": ["closeout"] },
        "outcomes": {
          "success": { "next": "corner_shot_horns" },
          "stolen": { "next": "end_turnover", "probability": 0.1 }
        }
      },
      {
        "id": "corner_shot_horns",
        "type": "shot",
        "duration": 0.7,
        "shotType": "threePoint",
        "actor": "corner1",
        "attributes": { "offense": ["threePoint"], "defense": ["perimeterDefense"] },
        "outcomes": {
          "made": { "next": "end_made", "points": 3 },
          "missed": { "next": "rebound_battle" }
        }
      },
      {
        "id": "dribble_handoff",
        "type": "handoff",
        "duration": 1.2,
        "actor": "point",
        "receiver": "corner1",
        "movement": {
          "point": { "x": 0.25, "y": 0.5 },
          "corner1": { "x": 0.3, "y": 0.45 }
        },
        "attributes": { "offense": ["ballHandling"], "defense": ["perimeterDefense"] },
        "outcomes": {
          "shooter_attack": { "next": "dho_attack", "probability": 0.7 },
          "turnover": { "next": "end_turnover", "probability": 0.3 }
        }
      },
      {
        "id": "dho_attack",
        "type": "drive",
        "duration": 1.0,
        "actor": "corner1",
        "movement": { "corner1": { "x": 0.45, "y": 0.6 } },
        "attributes": { "offense": ["speedWithBall", "ballHandling"], "defense": ["perimeterDefense"] },
        "outcomes": {
          "pull_up": { "next": "dho_jumper", "probability": 0.6 },
          "finish": { "next": "dho_layup", "probability": 0.4 }
        }
      },
      {
        "id": "dho_jumper",
        "type": "shot",
        "duration": 0.7,
        "shotType": "midRange",
        "actor": "corner1",
        "attributes": { "offense": ["midRange"], "defense": ["perimeterDefense"] },
        "outcomes": {
          "made": { "next": "end_made", "points": 2 },
          "missed": { "next": "rebound_battle" }
        }
      },
      {
        "id": "dho_layup",
        "type": "shot",
        "duration": 0.6,
        "shotType": "paint",
        "actor": "corner1",
        "movement": { "corner1": { "x": 0.5, "y": 0.8 } },
        "attributes": { "offense": ["layup"], "defense": ["block"] },
        "outcomes": {
          "made": { "next": "end_made", "points": 2 },
          "missed": { "next": "rebound_battle" }
        }
      }
    ],
    "badgeEffects": {
      "horns_pnr_left": ["brick_wall"],
      "horns_pnr_right": ["brick_wall"],
      "elbow_three": ["catch_and_shoot"],
      "corner_shot_horns": ["corner_specialist"]
    }
  }
];

export default playsMaster;
