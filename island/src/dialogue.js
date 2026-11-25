// Every conversation on Palmera Cay.
//
// A character is { name, title, color, start(s) -> node id, nodes }.
// A node is { text, choices }. text may be a function of (state, game).
// A choice is { text, if?, fx?, set?, act?, go?, end?, close? }:
//   if(s)   only offered when true
//   fx      meter changes: fun, relax, energy, sunburn, credits
//   set     flags to set true (array) or assign (object)
//   act(g)  run game logic; with close:true the dialogue closes first
//   go      next node id; end: close the dialogue

const pick = (g, key, lines) => lines[g.counter(key) % lines.length];

const DRINKS = {
  lobster: ['The Lobster Thermidor', 'Aloe-infused, served in the shade. Which, please, you should also be served in.', { relax: 8, sunburn: -10, fun: 4 }],
  mild: ['The Mild Disappointment', "Tastes like a Tuesday. Kidding. It tastes like a Saturday that finally got its act together.", { fun: 13, relax: 4 }],
  unread: ['The Unread Notification', "Chamomile, coconut rum, and a tiny umbrella that means 'not now.'", { relax: 13, fun: 4 }],
  second: ['The Second Wind', "Cold brew, coconut water, and a dash of 'you can nap later.'", { energy: 22, fun: 5 }],
  last: ['The Last Sunset', "It's sweeter because it ends. Like a vacation. Like everything. Enjoy it.", { fun: 9, relax: 9 }],
  random: [
    ['The Hammock Theory', 'Passion fruit, lime, and the radical idea that you are allowed to lie down.', { fun: 8, relax: 9 }],
    ['Low Tide Feelings', 'Gentle. Salty. A little exposed. You know what you did.', { fun: 9, relax: 8 }],
    ['The Unbothered', "Pineapple, rum, and the confidence of a man who has never once replied-all.", { fun: 8, relax: 10 }],
    ['Sand in Unexpected Places', "It's a lot. It's gritty. You'll be finding it for weeks. You'll love it.", { fun: 11, relax: 6 }],
  ],
};

function diagnose(s, g) {
  let d;
  if (s.sunburn > 55) d = DRINKS.lobster;
  else if (s.energy < 28) d = DRINKS.second;
  else if (s.fun < 38) d = DRINKS.mild;
  else if (s.relax < 38) d = DRINKS.unread;
  else if (s.day === 3 && s.hour > 17) d = DRINKS.last;
  else d = DRINKS.random[g.counter('drinkPick') % DRINKS.random.length];
  return d;
}

export const CHARACTERS = {
  // ----------------------------------------------------------------- DEZ
  dez: {
    name: 'Dez',
    title: 'Bartender, The Salty Coconut',
    color: '#0d7377',
    start: (s) => (s.flags.metDez ? 'hub' : 'intro'),
    nodes: {
      intro: {
        text: "Welcome to The Salty Coconut. I'm Dez. I don't make drinks. I make diagnoses. Then I make drinks.",
        choices: [
          { text: 'Diagnose me, doctor.', go: 'diag' },
          { text: 'Just a water, please.', fx: { energy: 6 }, set: ['metDez'], go: 'water' },
        ],
      },
      diag: {
        text: (s) =>
          s.items.phone
            ? "Mm. Shoulders up by your ears. Thumb twitching like it's looking for a phone. You checked your email at the departure gate, didn't you?"
            : "Mm. You've already lost the phone. Good. But your jaw's still clenched like it's in a quarterly review.",
        choices: [
          { text: '...Twice.', go: 'rx' },
          { text: 'I would never.', fx: { fun: 3 }, go: 'lie' },
        ],
      },
      rx: {
        text: "Twice. Okay. I'm prescribing The Out-of-Office: rum, lime, and the sound of you not replying. First one's on the house.",
        choices: [{ text: 'Cheers, Dez.', fx: { fun: 5, relax: 8 }, set: ['metDez'], go: 'hub' }],
      },
      lie: {
        text: "Your pocket just buzzed, friend. I could hear it over the ocean. Here. The Out-of-Office. On the house.",
        choices: [{ text: 'Thank you.', fx: { fun: 5, relax: 7 }, set: ['metDez'], go: 'hub' }],
      },
      water: {
        text: "Water. Bold. Very 'I read a wellness blog on the plane.' On the house. Come back when you're ready to feel something.",
        choices: [{ text: 'Will do.', go: 'hub' }],
      },
      hub: {
        text: (s, g) => {
          if (s.sunburn > 60) return "Friend, you look like a medium-rare steak. I'm legally obligated to mention the shade.";
          if (s.hour >= 21) return "Late shift. The ocean's doing its night voice. What can I get you?";
          return pick(g, 'dezHub', [
            "What'll it be?",
            'The ocean called. Said you can stay as long as you want.',
            'Back again. The coconut whispered you would come.',
            "Dez polishes a glass that is already clean. It's a lifestyle.",
          ]);
        },
        choices: [
          { text: 'Diagnose me a drink. ($12)', if: (s) => s.credits >= 12 && s.today.drinks < 3, act: (g) => g.orderDrink(diagnose(g.s, g)), go: 'drink' },
          { text: 'Diagnose me a drink.', if: (s) => s.today.drinks >= 3, go: 'cutoff' },
          { text: 'Something to eat? ($8)', if: (s) => s.credits >= 8 && !s.items.snack, go: 'snack' },
          { text: 'Got anything... special?', if: (s) => !s.flags.coconutQuest, set: ['coconutQuest'], go: 'coconut' },
          { text: 'One Existential Coconut, please.', if: (s) => s.items.coconut && s.flags.coconutQuest && !s.flags.existential, go: 'existential' },
          { text: 'Any gossip?', go: 'gossip' },
          { text: "What's the deal with that seagull?", if: (s) => !s.flags.askedKevin, set: ['askedKevin'], go: 'kevin' },
          { text: 'Could you hold my phone? Like... forever?', if: (s) => s.items.phone, go: 'phone' },
          { text: 'See you later, Dez.', end: true },
        ],
      },
      drink: {
        text: (s, g) => `"${g.lastDrink[0]}." He slides it across the counter. "${g.lastDrink[1]}"`,
        choices: [{ text: 'Cheers.', go: 'hub' }],
      },
      cutoff: {
        text: "That's three feelings today, friend. Here's a water and an honest compliment: your eyebrows are noticeably more relaxed than when you arrived.",
        choices: [{ text: 'Thanks, Dez.', fx: { energy: 4, relax: 2 }, go: 'hub' }],
      },
      snack: {
        text: "Fish taco, plantain chips, or the churro. The churro's very popular. Mostly with Kevin.",
        choices: [
          { text: "Fish taco. I'll eat it right here.", fx: { credits: -8, fun: 4, relax: 4, energy: 16 }, go: 'here' },
          { text: "Churro to go. I'm eating it on a lounger like royalty.", fx: { credits: -8 }, act: (g) => g.give('snack'), go: 'togo' },
          { text: 'Never mind.', go: 'hub' },
        ],
      },
      here: { text: 'Excellent choice. Under the roof is the one place Kevin respects. Mostly.', choices: [{ text: '(eat)', go: 'hub' }] },
      togo: {
        text: "To go. Brave. If a seagull makes eye contact with you, don't negotiate. Just walk faster. Loungers are down on the sand.",
        choices: [{ text: 'Got it.', end: true }],
      },
      coconut: {
        text: "There's one drink. The Existential Coconut. Can't make it with store coconuts. It needs a coconut with history. The old grove inland has palms short enough to shake. Bring me one and it's on the house.",
        choices: [{ text: "I'll find you a coconut with history.", go: 'hub' }],
      },
      existential: {
        text: 'Dez splits it with one chop, adds something from an unlabeled bottle, and a paper umbrella. You sip. For eleven seconds you understand everything: taxes, tides, why Kevin is the way he is. Then it passes. You feel incredible.',
        choices: [
          {
            text: 'Whoa.',
            act: (g) => {
              g.take('coconut');
              g.fx({ relax: 25, fun: 15 });
              g.memory('existential', 'Drank The Existential Coconut and understood everything for eleven seconds.');
            },
            set: ['existential'],
            go: 'hub',
          },
        ],
      },
      gossip: {
        text: (s, g) => {
          const lines = [
            "Gary's been trying to send one email since Tuesday. Word is the only signal on the island is up on the hill by the lighthouse. Don't tell him I told you. Actually, do. He keeps holding his laptop over my blender.",
            "Brenda has an itinerary for her itinerary. Laminated. I watched her schedule a nap and then power-walk to it.",
            'The Captain says forty years at sea. Ask him what happened to The Unsinkable I. Watch his face.',
            "Nana Pearl hustled me out of three piña coladas at volleyball last week. She's eighty-four. I don't want to talk about it.",
            "Marisol does sunset yoga on the west deck, five-ish. I don't know about chakras, but I've never seen anyone leave it stressed.",
            'Honestly? The best thing on this island is nothing. The hammock, inland from the beach. Twenty minutes. Life-changing.',
          ];
          const i = g.counter('dezGossip') % lines.length;
          if (i === 0) g.setFlag('knowsWifi');
          return lines[i];
        },
        choices: [{ text: 'Juicy.', fx: { fun: 2 }, go: 'hub' }],
      },
      kevin: {
        text: "That's Kevin. Kevin has eaten more churros than you've had hot dinners. Kevin fears neither God nor man nor broom. If you buy food, eat it under the roof.",
        choices: [{ text: 'Noted. Respect Kevin.', go: 'hub' }],
      },
      phone: {
        text: "In the ice bin, with the limes? Sure. It'll be cool. Emotionally. You can have it back when you leave. ...Unless you don't want it back.",
        choices: [
          {
            text: 'Take it. Please.',
            act: (g) => {
              g.take('phone');
              g.fx({ relax: 18 });
              g.memory('phone_dez', "Surrendered your phone to the bartender's ice bin. You haven't felt this free since you were nine.");
            },
            go: 'hub',
          },
          { text: "Actually... I'm not ready.", go: 'hub' },
        ],
      },
    },
  },

  // -------------------------------------------------------------- BRENDA
  brenda: {
    name: 'Brenda Pike',
    title: 'Itinerary enthusiast, Dayton, Ohio',
    color: '#ff5d8f',
    start: (s) => (s.flags.metBrenda ? 'hub' : 'intro'),
    nodes: {
      intro: {
        text: "Oh! A new face! Brenda Pike, Dayton, Ohio. Are you on the 10:15 Kayak-and-Kale, or the 10:20 Kale-and-Kayak?",
        choices: [
          { text: "I don't really have a plan.", set: ['metBrenda'], go: 'noplan' },
          { text: 'Kale-and-Kayak. Obviously.', set: ['metBrenda'], fx: { fun: 4 }, go: 'pen' },
        ],
      },
      pen: { text: "A person of taste! I'll pencil you in. Pen, actually. This is happening.", choices: [{ text: 'Great...', go: 'hub' }] },
      noplan: {
        text: "No... plan? You're on an island with no plan? What if something fun happens and you're not READY?",
        choices: [
          { text: "Then I guess I'll... have fun?", fx: { relax: 2 }, go: 'notHow' },
          { text: 'Could I see your itinerary?', go: 'itinerary' },
        ],
      },
      notHow: { text: "That's not how fun works. Fun is scheduled. Fun is laminated.", choices: [{ text: 'Is it, though?', go: 'hub' }] },
      itinerary: {
        text: "She holds it up proudly. It's laminated. Twice.\n\n06:00  Sunrise (attend)\n06:15  Gratitude jog\n07:00  Breakfast, part one\n09:30  Competitive shell sorting\n11:47  Spontaneous fun (pre-approved)\n14:00  Relax (vigorously)\n22:25  Lie down (personal best attempt)",
        choices: [{ text: "'Relax vigorously'?", fx: { fun: 6 }, go: 'vigor' }],
      },
      vigor: {
        text: 'You relax harder when you focus! I did forty-five minutes of relaxing yesterday and my heart rate was a hundred and sixty.',
        choices: [{ text: "That's... a lot.", go: 'hub' }],
      },
      hub: {
        text: (s, g) => {
          if (s.flags.brendaRelaxed) return pick(g, 'brendaChill', ["I have no idea what time it is and I LOVE it.", 'Did you know clouds just... go wherever? No schedule. Icons.', "I took off both watches. My wrists can breathe. I didn't know wrists breathed."]);
          if (s.sunburn > 55 && !s.flags.brendaSunscreen) return 'Sweetie. SWEETIE. You are the color of a stop sign.';
          return pick(g, 'brendaHub', ['Brenda checks her watch. Then her other watch.', "Can't stop long, I've got Mandatory Leisure in six minutes!", "Have you hydrated? I've hydrated four times. It's on the card."]);
        },
        choices: [
          { text: 'Brenda, have you ever tried just... lying down?', if: (s) => !s.flags.brendaRelaxed && (s.flags.brendaStage || 0) === 0, go: 'stage0' },
          { text: "About lying down for no reason...", if: (s) => !s.flags.brendaRelaxed && s.flags.brendaStage === 1, go: 'stage1' },
          { text: "Ready for fifteen minutes of nothing?", if: (s) => !s.flags.brendaRelaxed && s.flags.brendaStage === 2, go: 'stage2' },
          { text: "Got any spare sunscreen?", if: (s) => s.sunburn > 55 && !s.flags.brendaSunscreen && !s.flags.brendaRelaxed, go: 'spf' },
          { text: "What's on the itinerary right now?", if: (s) => !s.flags.brendaRelaxed && s.today.brendaJoin < 1, go: 'join' },
          { text: 'See you around, Brenda.', go: 'bye' },
        ],
      },
      bye: { text: (s) => (s.flags.brendaRelaxed ? 'Around! Whenever! Who cares!' : "'Around' is not a time, but okay!"), choices: [{ text: '(leave)', end: true }] },
      spf: {
        text: 'Here. SPF 50. I have eleven. I have a bottle for my bottles. Reapply every two hours, I set an alarm.',
        choices: [{ text: 'Thank you, Brenda.', set: ['brendaSunscreen'], act: (g) => g.applySunscreen(3), go: 'hub' }],
      },
      join: {
        text: "Perfect timing! It's Competitive Shell Sorting o'clock! You can be on my team. Team Brenda. Usually it's just me.",
        choices: [
          {
            text: "Let's sort some shells.",
            close: true,
            act: (g) => {
              g.s.today.brendaJoin++;
              g.narrate(
                ['You sort shells by size, by color, by "vibe," and by "potential."', 'Brenda wins. You were on her team. She still wins. She gives you a gold star sticker that says "TEAM BRENDA (CO-CAPTAIN)."'],
                () => g.fx({ fun: 12, energy: -12, relax: -4 }),
                1
              );
            },
          },
          { text: 'Maybe later.', go: 'hub' },
        ],
      },
      stage0: {
        text: "Lying down is scheduled for 22:25! Last night I made it by 22:31. I'm getting faster.",
        choices: [{ text: "That's not what I meant.", go: 'stage0b' }],
      },
      stage0b: {
        text: "Brenda pauses. You get the sense she has never paused before. \"...What did you mean?\"",
        choices: [{ text: 'Just lying down. For no reason at all.', set: { brendaStage: 1 }, fx: { fun: 3 }, go: 'stage0c' }],
      },
      stage0c: { text: "For NO reason? ...I'll have to think about that. I'll schedule some time to think about it.", choices: [{ text: 'You do that.', go: 'hub' }] },
      stage1: {
        text: "You keep saying 'lie down for no reason.' Have YOU done it? Personally? I need data.",
        choices: [
          { text: 'I spent an hour in the hammock. Nothing bad happened.', if: (s) => s.flags.usedHammock, go: 'stage1b' },
          { text: 'Not yet.', go: 'stage1n' },
        ],
      },
      stage1n: { text: "Hmph. Come back with data. Preferably in a chart.", choices: [{ text: '(The hammock is inland from the south beach.)', go: 'hub' }] },
      stage1b: {
        text: 'Nothing? No emails? No... consequences?',
        choices: [{ text: 'Just a breeze and a gecko that sat on my knee.', set: { brendaStage: 2 }, fx: { relax: 4 }, go: 'stage1c' }],
      },
      stage1c: { text: 'A gecko. On your KNEE. ...Let me look at my week and get back to you.', choices: [{ text: 'Take your time. That is the point.', go: 'hub' }] },
      stage2: {
        text: "Fine. FINE. Fifteen minutes. Penciled. Not inked. Where is this famous hammock?",
        choices: [
          {
            text: "Come on. I'll show you.",
            close: true,
            set: ['brendaRelaxed'],
            act: (g) => {
              g.narrate(
                [
                  'You walk Brenda to the hammock. She gets in like someone being lowered into a cold pool.',
                  'Minute one: she checks her watch. Minute four: she checks her other watch. Minute nine: she takes both watches off.',
                  'Minute fifteen comes and goes. Brenda is asleep. She snores. It is the most peaceful sound on the island.',
                  'Later she finds you. Her itinerary has a big X across it, drawn in sunscreen. "I want you to have these," she says, and hands you her SPF 100 and a snorkel voucher. "I don\'t need to plan for them anymore."',
                ],
                () => {
                  g.fx({ relax: 20, fun: 12 });
                  g.give('spf100');
                  g.give('voucher');
                  g.applySunscreen(6);
                  g.memory('brenda', 'Taught Brenda Pike to do absolutely nothing. She cried a little. Good tears.');
                },
                0.75
              );
            },
          },
          { text: 'Actually, not right now.', go: 'hub' },
        ],
      },
    },
  },

  // ------------------------------------------------------------- CAPTAIN
  captain: {
    name: 'Captain Lorenzo Bellamy',
    title: 'Snorkel tours · "40 years at sea"',
    color: '#1f5fa8',
    start: (s) => (s.flags.metCaptain ? 'hub' : 'intro'),
    nodes: {
      intro: {
        text: 'Ahoy! Captain Lorenzo Bellamy. Forty years on the open water.',
        choices: [
          { text: 'Forty years! Where?', set: ['metCaptain'], go: 'where' },
          { text: 'Ahoy, Captain!', set: ['metCaptain'], fx: { fun: 3 }, go: 'ahoy' },
        ],
      },
      where: {
        text: "Lake Michigan. Well. A pond. Near Lake Michigan. It had ducks, sailor. Aggressive ducks. You don't forget a duck like that.",
        choices: [{ text: 'I imagine not.', fx: { fun: 5 }, go: 'hub' }],
      },
      ahoy: { text: "Now THAT is a greeting. Most people just say 'Is that boat safe?'", choices: [{ text: 'Is that boat safe?', fx: { fun: 3 }, go: 'safe' }] },
      safe: { text: 'She is named The Unsinkable II. Read into that what you will.', choices: [{ text: '...', go: 'hub' }] },
      hub: {
        text: (s, g) => {
          if (s.hour < 9 || s.hour >= 16) return "Tours run nine to four, sailor. The ocean needs her rest. Union rules.";
          return pick(g, 'capHub', ['The Captain squints at the horizon like it owes him money.', "Fair winds today. Or at least winds. I'm not an expert on fairness.", "Reef's calling, sailor. Can you hear it? That's either the reef or my knee."]);
        },
        choices: [
          { text: 'Book a snorkel tour. ($60)', if: (s) => s.hour >= 9 && s.hour < 16 && s.credits >= 60 && !s.items.voucher && s.today.tours < 1, go: 'book' },
          { text: "Use Brenda's snorkel voucher.", if: (s) => s.hour >= 9 && s.hour < 16 && s.items.voucher && s.today.tours < 1, go: 'bookV' },
          { text: 'What happened to The Unsinkable I?', if: (s) => !s.flags.askedU1, set: ['askedU1'], go: 'u1' },
          { text: 'Any sailing wisdom?', go: 'wisdom' },
          { text: 'Fair winds, Captain.', end: true },
        ],
      },
      book: {
        text: "Two hours, the reef, a sea turtle if she's in the mood, and my running commentary at no extra charge. Climb aboard!",
        choices: [
          { text: "Let's go!", close: true, act: (g) => g.tour(false) },
          { text: 'Maybe later.', go: 'hub' },
        ],
      },
      bookV: {
        text: "A Brenda voucher! Laminated! I've never seen one actually redeemed. Climb aboard, sailor!",
        choices: [{ text: "Let's go!", close: true, act: (g) => g.tour(true) }],
      },
      u1: { text: "We don't talk about The Unsinkable I.", choices: [{ text: '...It sank, didn\'t it?', go: 'u1b' }] },
      u1b: { text: 'She was *reassigned to the seabed*. With full honors. The ducks attended.', choices: [{ text: 'My condolences.', fx: { fun: 6 }, go: 'hub' }] },
      wisdom: {
        text: (s, g) => {
          const lines = [
            "Red sky at night, sailor's delight. Red sky in the morning? That's your sunburn, son. Get some shade.",
            'Never trust a fish that looks you in the eye. It is planning something.',
            'A good captain always knows where the snacks are.',
            'The sea gives, and the sea takes. Mostly it takes sunglasses.',
            "If you see someone on the hill by the lighthouse at night waving a laptop, that's not a ghost. That's Gary. He thinks there's Wi-Fi up there. There is, actually.",
          ];
          const i = g.counter('capWisdom') % lines.length;
          if (i === 4) g.setFlag('knowsWifi');
          return lines[i];
        },
        choices: [{ text: 'Aye aye.', fx: { fun: 2 }, go: 'hub' }],
      },
    },
  },

  // ---------------------------------------------------------------- GARY
  gary: {
    name: 'Gary Lindqvist',
    title: 'Has been trying to send one email for four days',
    color: '#5b8bd9',
    start: (s, g) => {
      if (!s.flags.metGary) return 'intro';
      if (s.flags.garyDone) return 'free';
      if (s.flags.garyToLighthouse && g.garyAtWifi()) return 'sent';
      return 'hub';
    },
    nodes: {
      intro: {
        text: "Don't move. DON'T move. I had half a bar when you were standing there... Gone. Hi. Gary. I need to send one email. It's been four days. It has an attachment.",
        choices: [
          { text: "What's the email?", set: ['metGary'], go: 'email' },
          { text: 'Have you tried turning the island off and on again?', set: ['metGary'], fx: { fun: 6 }, go: 'offon' },
        ],
      },
      email: {
        text: "It says 'Sounds good!' That's it. My boss wants to 'circle back after the holiday,' and if I don't say 'Sounds good!' before the holiday ends, I'll have to circle back to the circle back.",
        choices: [{ text: 'Oof.', fx: { fun: 5 }, go: 'hub' }],
      },
      offon: { text: "...Is that possible? Don't joke. I'm in a fragile place.", choices: [{ text: 'Sorry, Gary.', go: 'hub' }] },
      hub: {
        text: (s, g) =>
          s.flags.garyToLighthouse
            ? "I'm heading for the lighthouse! Elevation, baby! ...Is it this way? It's uphill. Everything good is uphill."
            : pick(g, 'garyHub', ['Gary rotates slowly, laptop raised like an offering to a very specific god.', 'Can you see bars? Do I have bars? I need ONE bar.', 'I tried the dock. I tried the bar. I tried standing in the sea. A fish judged me.']),
        choices: [
          { text: "I heard there's signal up on the hill by the lighthouse.", if: (s) => s.flags.knowsWifi && !s.flags.garyToLighthouse, set: ['garyToLighthouse'], go: 'lighthouse' },
          { text: 'Gary... what if you just didn\'t send it?', if: (s) => !s.flags.garyToLighthouse && (s.relax >= 55 || !s.items.phone), go: 'nosend' },
          { text: 'I think this is your sandal?', if: (s) => s.items.sandal, go: 'sandal' },
          { text: 'Any luck so far?', go: 'luck' },
          { text: 'Good luck, Gary.', end: true },
        ],
      },
      luck: {
        text: 'Yesterday I got one bar standing on one leg in the surf at low tide. Then a wave hit me. The bar was gone. So was my sandal. The sandal had sentimental value.',
        choices: [{ text: 'RIP sandal.', fx: { fun: 3 }, go: 'hub' }],
      },
      lighthouse: {
        text: "The LIGHTHOUSE? Of course! Height! Elevation! Lighthouses are basically ancient routers! Meet me up there!",
        choices: [{ text: 'Go get it, Gary.', end: true }],
      },
      nosend: {
        text: "Not... send it? But then they'd circle back. They'd circle back, and then—",
        choices: [
          { text: 'Let them circle, Gary.', go: 'circle' },
          { text: 'Never mind.', go: 'hub' },
        ],
      },
      circle: {
        text: 'He looks at the laptop. He looks at the ocean. He looks at the laptop. "Let them... circle." A long breath. "LET THEM CIRCLE!"',
        choices: [
          {
            text: '(watch)',
            close: true,
            set: ['garyDone', 'garyBuried'],
            act: (g) => {
              g.narrate(
                [
                  'Gary digs a hole in the sand with the focus of a man who has finally found a deliverable he believes in.',
                  'He lowers the laptop in. He says a few words. You think one of them is "synergy." He covers it with sand and puts a shell on top.',
                  'Then he takes off his socks. Both of them. He walks into the sea up to his knees and laughs for the first time in four days.',
                ],
                () => {
                  g.fx({ fun: 15, relax: 12 });
                  g.memory('gary_bury', 'Talked Gary into burying his laptop in the sand like pirate treasure.');
                },
                0.25
              );
            },
          },
        ],
      },
      sent: {
        text: "IT SENT. It actually sent. 'Sounds good!' Do you know what that feels like? It feels like... wait. Was the ocean always this color?",
        choices: [
          {
            text: 'Welcome to vacation, Gary.',
            set: ['garyDone'],
            act: (g) => {
              g.fx({ fun: 10, relax: 10 });
              g.memory('gary_sent', "Helped Gary finally send the words 'Sounds good!' He wept at the view.");
            },
            go: 'closeLaptop',
          },
        ],
      },
      sandal: {
        text: "My SANDAL. You found my sandal! I lost it in the surf chasing one bar of signal. My nan gave me these. Well, she gave me a gift card and I bought these. Same thing.",
        choices: [
          {
            text: 'Found it fishing, actually.',
            act: (g) => {
              g.take('sandal');
              g.fx({ fun: 8, relax: 5 });
              g.memory('sandal', "Fished up Gary's lost sandal and returned it. He held it like a newborn.");
            },
            go: 'sandal2',
          },
        ],
      },
      sandal2: { text: "Gary puts it on immediately, then the other one, then takes them both off again to feel the sand. 'Balance,' he says.", choices: [{ text: '(nod)', end: true }] },
      closeLaptop: { text: 'Gary closes the laptop. Gently. Like a book he has finished.', choices: [{ text: '(nod)', end: true }] },
      free: {
        text: (s, g) =>
          pick(g, 'garyFree', [
            "I went in the ocean today. On purpose! Did you know there are fish in there?",
            'I had a churro. Kevin took half. I let him. We have an understanding now.',
            "I haven't thought about a spreadsheet in hours. I can't remember what a pivot table is. It's beautiful.",
          ]),
        choices: [
          { text: 'I think this is your sandal?', if: (s) => s.items.sandal, go: 'sandal' },
          { text: 'Proud of you, Gary.', fx: { relax: 2 }, end: true },
        ],
      },
    },
  },

  // ------------------------------------------------------------- MARISOL
  marisol: {
    name: 'Marisol Vega-Sun',
    title: 'Wellness guide · aura consultant',
    color: '#8e5cc9',
    start: (s) => (s.flags.metMarisol ? 'hub' : 'intro'),
    nodes: {
      intro: {
        text: "Oh! Your aura is so... beige. No, no, it's okay! Beige is just a color waiting to become a sunset.",
        choices: [
          { text: 'My aura is what?', set: ['metMarisol'], go: 'beige' },
          { text: 'Thank you?', set: ['metMarisol'], fx: { relax: 3 }, go: 'compliment' },
        ],
      },
      beige: {
        text: "Beige! Like an office carpet. Like a spreadsheet's dreams. We can fix it. Sunset yoga, on the west deck, around five.",
        choices: [{ text: "I'll think about it.", fx: { fun: 4 }, go: 'hub' }],
      },
      compliment: { text: "You're welcome. That was a compliment in the language of chakras.", choices: [{ text: 'Neat.', go: 'hub' }] },
      hub: {
        text: (s, g) =>
          s.hour >= 16.5 && s.hour < 19.75
            ? "Marisol unrolls a mat facing the sun. 'The sun is about to do its best work. Join me?'"
            : pick(g, 'marHub', ['Marisol balances on one foot, eyes closed, completely unbothered.', 'Breathe with me. In... and out. You just did yoga. Congratulations.', "Have you met the ocean? Properly? You should introduce yourself."]),
        choices: [
          { text: 'Join sunset yoga.', if: (s) => s.hour >= 16.5 && s.hour < 19.75 && s.today.yoga < 1, close: true, act: (g) => g.yoga() },
          { text: 'Got any wellness tips?', go: 'tip' },
          { text: 'Is any of this scientifically proven?', if: (s) => !s.flags.askedScience, set: ['askedScience'], go: 'science' },
          { text: 'My phone keeps buzzing.', if: (s) => s.items.phone, set: ['hintBury'], go: 'phone' },
          { text: 'Namaste.', go: 'namaste' },
        ],
      },
      tip: {
        text: (s, g) =>
          pick(g, 'marTip', [
            'Hydrate. The ocean is ninety-seven percent water, and look how relaxed it is.',
            'Every time you check your phone, a sea turtle sighs.',
            'Sand is just tiny rocks that have learned to let go.',
            'Your inner child wants a nap and a snack. Listen to your inner child.',
            'Float on your back in the sea. Let it hold you. It holds whales. It can handle you.',
          ]),
        choices: [{ text: 'Wise.', fx: { relax: 3 }, go: 'hub' }],
      },
      science: { text: 'Science is just vibes that wrote things down.', choices: [{ text: 'Fair.', fx: { fun: 5 }, go: 'hub' }] },
      phone: {
        text: "Mm. That's your aura trying to leave through your pocket. Have you considered... letting the sand hold it for you? Next time it buzzes. Just a thought. A beige thought, becoming a sunset.",
        choices: [{ text: 'Bury it. Interesting.', go: 'hub' }],
      },
      namaste: { text: "Namaste. It means 'the beige in me honors the beige in you.'", choices: [{ text: '(bow)', end: true }] },
    },
  },

  // --------------------------------------------------------------- PEARL
  pearl: {
    name: 'Nana Pearl',
    title: 'Age 84 · undefeated since Tuesday',
    color: '#b5179e',
    start: (s) => (s.flags.metPearl ? 'hub' : 'intro'),
    nodes: {
      intro: {
        text: 'Pull up, rookie. You play? Course you don\'t. Look at those knees. Pearl Abernathy. Eighty-four years young. Undefeated since Tuesday.',
        choices: [
          { text: 'Undefeated since Tuesday?', set: ['metPearl'], go: 'tuesday' },
          { text: "I'll have you know I'm very good at volleyball.", set: ['metPearl'], go: 'good' },
        ],
      },
      tuesday: { text: 'Lost to a lifeguard. He cheated. He was nineteen and had working joints.', choices: [{ text: 'Seems unfair.', fx: { fun: 5 }, go: 'hub' }] },
      good: { text: 'Ha! That is what my third husband said. Lovely man. Terrible at volleyball.', choices: [{ text: 'Wow.', fx: { fun: 5 }, go: 'hub' }] },
      hub: {
        text: (s, g) =>
          s.flags.beatPearl
            ? "Pearl narrows her eyes at you. 'The wind was blowing that day and you know it.'"
            : pick(g, 'pearlHub', ['Pearl stretches a hamstring with frightening flexibility.', "Pearl spins the ball on one finger. 'Scared, rookie?'", "Stretch your hamstrings. You walk like a folding chair."]),
        choices: [
          { text: "Let's play. First to three.", if: (s) => s.today.volley < 2 && s.energy >= 12, close: true, act: (g) => g.volleyball() },
          { text: "I'm too tired to play right now.", if: (s) => s.energy < 12, go: 'tired' },
          { text: 'Does this ring mean anything to you?', if: (s) => s.items.ring, go: 'ring' },
          { text: 'Any life advice?', go: 'advice' },
          { text: 'How did you get so good?', if: (s) => !s.flags.askedPearl, set: ['askedPearl'], go: 'origin' },
          { text: 'Bye, Pearl.', end: true },
        ],
      },
      ring: {
        text: "Pearl goes very still. 'That's Ricardo's ring. It vanished off my beach towel in 1998. I always said it was a seagull. Nobody believed me.' She turns it over. 'Kevin?' You nod. 'Kevin's grandfather, then. It runs in the family.'",
        choices: [
          {
            text: 'It belongs with you.',
            act: (g) => {
              g.take('ring');
              g.fx({ fun: 10, relax: 12 });
              g.memory('ring', "Returned Ricardo's ring to Nana Pearl, twenty-eight years after a seagull stole it.");
            },
            go: 'ring2',
          },
        ],
      },
      ring2: { text: "She puts it on a chain around her neck. 'Rematch tomorrow, rookie. I'm going to play even better now. Ricardo's watching.'", choices: [{ text: 'Looking forward to losing.', end: true }] },
      tired: { text: "Tired? I'm eighty-four and I did a cartwheel this morning. Go have a nap, rookie. Then come back and lose.", choices: [{ text: 'Okay.', go: 'hub' }] },
      advice: {
        text: (s, g) =>
          pick(g, 'pearlAdvice', [
            'Marry someone who laughs at your jokes, outlive your enemies, and never trust a seagull named Kevin.',
            'Nap like it is your job. I napped through two recessions and a moon landing.',
            "Sunscreen, sweetheart. I look this good because I've been in the shade since 1971.",
            'Life is short. Eat the churro. Eat it indoors, though. Kevin.',
          ]),
        choices: [{ text: 'Thanks, Pearl.', fx: { fun: 3, relax: 2 }, go: 'hub' }],
      },
      origin: {
        text: '1962 Olympic trials. Didn\'t make the team. Got distracted by a lifeguard named Ricardo. Married him. Worth it. Then I had sixty years to practice out of spite.',
        choices: [{ text: 'Respect.', fx: { fun: 6 }, go: 'hub' }],
      },
    },
  },

  // ---------------------------------------------------------------- SKYE
  skye: {
    name: 'Skye Marlowe',
    title: 'Lifestyle creator (412 followers)',
    color: '#c2407a',
    start: (s) => (s.flags.metSkye ? 'hub' : 'intro'),
    nodes: {
      intro: {
        text: "Oh my god, hi. Can you take my picture? Not a picture. Like, forty pictures. I'm Skye. Lifestyle creator. Four hundred and twelve followers, but they're very engaged.",
        choices: [
          { text: 'Sure. Forty pictures.', set: ['metSkye'], fx: { fun: 4, relax: -3 }, go: 'forty' },
          { text: "I'll take one. One good one.", set: ['metSkye', 'skyeGoodPhoto'], fx: { fun: 8, relax: 2 }, go: 'one' },
          { text: "Sorry, I'm on vacation from cameras.", set: ['metSkye'], fx: { relax: 3 }, go: 'nocam' },
        ],
      },
      forty: {
        text: "You take forty-one. She reviews each one with the face of a jeweller inspecting a fake diamond. 'Okay, number nineteen is giving... nothing. But it's giving it beautifully.'",
        choices: [
          { text: 'Want me to try one more? Properly?', set: ['skyeGoodPhoto'], fx: { fun: 4 }, go: 'one' },
          { text: 'Glad I could help.', end: true },
        ],
      },
      one: {
        text: "You crouch, wait for a wave to curl up behind her, and take a single photo. She stares at it for a long time. 'Oh. That's... me? I look like I'm actually here.'",
        choices: [{ text: 'You are actually here.', fx: { relax: 4 }, go: 'here' }],
      },
      here: {
        text: "'Huh.' She looks up from the screen at the actual sea for about one and a half seconds. Then back at the screen. Progress.",
        choices: [{ text: '(leave her to it)', end: true }],
      },
      nocam: {
        text: "She looks at you like you said you're on vacation from oxygen. 'That's so brave. Can I film you saying that?'",
        choices: [
          { text: 'No.', fx: { fun: 3 }, end: true },
          { text: "Fine. I'll take one picture of you. One.", set: ['skyeGoodPhoto'], fx: { fun: 6 }, go: 'one' },
        ],
      },
      hub: {
        text: (s, g) => {
          if (s.flags.skyePhoneDown)
            return pick(g, 'skyeOff', [
              "No phone. I keep reaching for it like a phantom limb. But I saw a fish. A real one. It didn't even know I was there.",
              "Do you know how long a wave takes when you're not filming it? Like four seconds. Every time. It's insane.",
              "My followers think I've been kidnapped. I have been. By the beach.",
            ]);
          if (s.flags.skyeGoodPhoto && s.hour >= 17 && !s.flags.skyeSunset)
            return "It's golden hour. You're the only person who's ever made me look like a person instead of a product. One more? Of both of us?";
          return pick(g, 'skyeOn', [
            "I posted your photo. Thirteen likes. One was my mom. Twice. She has two accounts.",
            "Someone commented 'goals.' I don't know them. I've never felt so seen.",
            "I'm doing a 'day in my life' but my life today is just standing here, so I'm doing it from more angles.",
            "Is that seagull following me? He's been in the back of eleven shots. I think he wants to collab.",
          ]);
        },
        choices: [
          {
            text: 'Take the golden-hour photo.',
            if: (s) => s.flags.skyeGoodPhoto && s.hour >= 17 && !s.flags.skyeSunset,
            set: ['skyeSunset'],
            act: (g) => g.memory('skye_sunset', "Took a sunset photo with Skye. She didn't post it. 'This one's mine,' she said."),
            fx: { fun: 10, relax: 8 },
            go: 'sunset',
          },
          { text: 'Put the phone down for an hour. Come look at the water.', if: (s) => !s.flags.skyePhoneDown, go: 'convince' },
          { text: 'Want to see my holiday photos?', if: (s, g) => g.photos && g.photos.length > 0 && !s.flags.skyeSawPhotos, go: 'photos' },
          { text: 'How is the content going?', fx: { fun: 3 }, go: 'hubAgain' },
          { text: 'Enjoy the beach, Skye.', end: true },
        ],
      },
      photos: {
        text: (s, g) => {
          const subj = new Set(g.photos.map((p) => p.subject));
          if (subj.has('skye')) return "She stops on the one of her. 'That's... me? I'm not even posing. I'm just standing there being on holiday.' She's quiet for a second. 'Can you send me this one? Not to post. To keep.'";
          if ([...subj].some((k) => ['macaw', 'ray', 'turtle', 'fiddler', 'hermit', 'butterfly', 'gulls', 'reg'].includes(k)))
            return "'Wait. You took these? With your actual eyes?' She scrolls back and forth. 'I've been here six hours and I've only photographed my own face. Where IS all this?'";
          return "'It's all views. There isn't a single person in any of them.' She looks genuinely moved. 'How did you get nobody in them? Teach me.'";
        },
        choices: [
          {
            text: '(show her how to point it at something else)',
            set: ['skyeSawPhotos'],
            fx: { fun: 6, relax: 4 },
            act: (g) => g.memory('skye_photos', 'Showed Skye your holiday photos. She pointed her phone at the sea for the first time all week.'),
            go: 'hub',
          },
        ],
      },
      hubAgain: {
        text: (s, g) => pick(g, 'skyeTalk', [
          "Honestly? I've been on this beach for six hours and I haven't touched the water. I've touched the water's hashtag.",
          "A brand messaged me! It was a scam. But it was a scam that thought I was worth scamming.",
          "My ring light died. I had to use the sun. The sun is SO harsh. Like, who lit this place?",
        ]),
        choices: [{ text: 'Mm.', go: 'hub' }],
      },
      convince: {
        text: (s) =>
          s.items.phone
            ? "'Says the person whose pocket has buzzed four times since you walked up.' ...Fair."
            : "'Wait. You don't have a phone? At all?' You shrug. She looks at her phone. She looks at the sea. 'Then what do you even DO all day?' You point at everything.",
        choices: [
          { text: '(touché)', if: (s) => s.items.phone, act: (g) => g.setFlag('hintBury'), end: true },
          {
            text: 'Come on.',
            if: (s) => !s.items.phone,
            set: ['skyePhoneDown'],
            fx: { fun: 6, relax: 8 },
            act: (g) => g.memory('skye_offline', 'Talked an influencer into putting her phone away. She looked at the sea like she had never seen it unfiltered.'),
            go: 'offline',
          },
        ],
      },
      offline: {
        text: "She turns the phone off. Not silent. Off. She holds it like a live grenade, then tucks it into her bag. 'If I start shaking, distract me.' You both watch a wave come in. Then another one. She doesn't film either.",
        choices: [{ text: 'Nice, right?', end: true }],
      },
      sunset: {
        text: "The sun slides into the sea behind you both. She takes it, looks at it once, and puts the phone away. 'I'm not posting this one,' she says. 'This one's mine.'",
        choices: [{ text: 'Good.', end: true }],
      },
    },
  },

  // ----------------------------------------------------------------- REG
  reg: {
    name: 'Reg',
    title: 'Bottlenose dolphin, on sabbatical',
    color: '#3f6f8f',
    start: (s) => (s.flags.metReg ? 'hub' : 'intro'),
    nodes: {
      intro: {
        text: "*Click-click-wheeee.* Oh, sorry. Wrong language. Hi. Reg. Bottlenose. I'm on sabbatical.",
        choices: [
          { text: 'A sabbatical from what?', go: 'job' },
          { text: '...You can talk?', go: 'talk' },
        ],
      },
      talk: {
        text: "Everyone can talk. Most people just don't stop to listen. Also I took an online course. Mostly the course.",
        choices: [{ text: 'A sabbatical from what, though?', go: 'job' }],
      },
      job: {
        text: 'I was Regional Sardine Coordinator for the eastern pod. Forty-two meetings a day. Every one of them could have been a sonar ping.',
        choices: [
          { text: 'That sounds awful.', set: ['metReg'], fx: { fun: 5 }, go: 'quit' },
          { text: 'Dolphins have meetings?', set: ['metReg'], fx: { fun: 6 }, go: 'circle' },
        ],
      },
      quit: {
        text: "It was. Then one morning I just... swam the other way. Didn't even set an out-of-office. Best decision of my life. Want to see something?",
        choices: [{ text: 'Sure.', go: 'hub' }],
      },
      circle: {
        text: "Dolphins invented meetings. Why do you think we're always swimming in circles? Anyway. I'm free now. Want to see something?",
        choices: [{ text: 'Sure.', go: 'hub' }],
      },
      hub: {
        text: (s, g) =>
          pick(g, 'regHub', [
            "The water's great today. It's always great. That's the thing about water.",
            "Back again! You look less like a spreadsheet than yesterday. It suits you.",
            'I had a fish for breakfast. And for lunch. Living the dream. The dream is fish.',
            "I've been practising doing nothing. I'm up to nine whole minutes. Personal best.",
          ]),
        choices: [
          {
            text: 'Do a trick!',
            close: true,
            act: (g) => {
              const spin = g.counter('regTrick') % 2 === 1;
              g.dolphin.leap(spin ? 'spin' : 'leap');
              const m = g.mult('regTrick');
              setTimeout(() => {
                g.ui.toast(spin ? 'Reg corkscrews out of the sea, spins twice and lands with a smack. Show-off.' : 'Reg launches clean out of the water and arcs over the waves.', 'good');
                g.fx({ fun: 10 * m, relax: 3 * m });
                g.memory('reg_leap', 'Watched a dolphin leap clear out of the sea, just for you.');
              }, 1300);
            },
          },
          { text: 'Can I hold on to your fin?', if: (s, g) => g.player.swimming, close: true, act: (g) => g.dolphin.startTow(g.player) },
          { text: 'Can I hold on to your fin?', if: (s, g) => !g.player.swimming, go: 'noride' },
          { text: 'Will you take my phone? Please.', if: (s) => s.items.phone, go: 'phone' },
          { text: 'Heard any gossip?', go: 'gossip' },
          { text: 'See you, Reg.', end: true },
        ],
      },
      noride: {
        text: "Get in the water first. I'm not a ferry. I'm a dolphin with boundaries.",
        choices: [{ text: 'Fair.', go: 'hub' }],
      },
      phone: {
        text: "He looks at the phone. He looks at you. 'Say no more.' He takes it gently in his beak, the way you'd carry something that had hurt you. 'I'll escalate it to the trench.' He dives. A few seconds later a single bubble comes up. It feels final.",
        choices: [
          {
            text: 'Thank you, Reg.',
            act: (g) => {
              g.take('phone');
              g.fx({ relax: 22, fun: 8 });
              g.memory('reg_phone', "Handed your work phone to a dolphin, who promised to 'escalate it to the trench.'");
            },
            end: true,
          },
        ],
      },
      gossip: {
        text: (s, g) => {
          const lines = [
            "The captain's first boat? I was there. I've said nothing. I will say nothing. ...It was the anchor. He forgot to tie the anchor to the boat. Then he threw it in. While standing on it.",
            "That seagull, Kevin, owes me three fish. I'm not saying I'm keeping score. I'm keeping score.",
            'Dez once made me a drink. I do not have hands. He made it anyway and left it on the dock. Respect.',
            "The man with the laptop holds it up over his head every day like he's offering it to the sky. The sky has not accepted.",
          ];
          if (s.flags.metSkye && !s.flags.skyePhoneDown) lines.push("The girl with the phone has photographed my fin forty-one times. She has never once looked at me. I counted. I'm a dolphin, I have time.");
          if (!s.items.sandal && !s.memories.some((m) => m.id === 'sandal')) lines.push("There's a sandal down by the dock that says GARY inside. I've been wearing it as a hat. Don't tell him.");
          return pick(g, 'regGossip', lines);
        },
        choices: [{ text: 'Reg!', fx: { fun: 4 }, go: 'hub' }],
      },
    },
  },

  // ---------------------------------------------------------------- CHAD
  chad: {
    name: 'Chad Bronson',
    title: 'Lifeguard (Certified*)',
    color: '#d62828',
    start: (s) => (s.flags.metChad ? 'hub' : 'intro'),
    nodes: {
      intro: {
        text: "*FWEEEEP.* Whoa. Whoa whoa whoa. That was a very confident walk. Borderline jog. I'm watching you. I'm Chad. I'm the lifeguard.",
        choices: [
          { text: "What's the asterisk for?", set: ['metChad'], go: 'asterisk' },
          { text: 'Can you swim?', set: ['metChad'], go: 'swim' },
        ],
      },
      asterisk: {
        text: 'Online course. Forty minutes. I got ninety-one percent. The other nine percent was the water part.',
        choices: [{ text: 'Reassuring.', fx: { fun: 5 }, go: 'hub' }],
      },
      swim: {
        text: "I'm a lifeguard. I guard. Swimming is a whole separate department.",
        choices: [{ text: 'Of course.', fx: { fun: 5 }, go: 'hub' }],
      },
      hub: {
        text: (s, g) =>
          pick(g, 'chadHub', [
            'Eyes on the water. Always. Except when I blink. I try to blink in shifts.',
            "Someone said 'Marco' an hour ago and nobody's said 'Polo' yet. I'm worried. I'm not getting in, but I'm worried.",
            "Every day I put on the visor and I become something greater. A man in a visor.",
          ]),
        choices: [
          { text: 'About this pool party...', if: (s) => s.flags.partyAnnounced && s.day === 2, go: 'party' },
          { text: 'Will you judge my cannonball?', go: 'judge' },
          { text: 'Ever had to save anyone?', go: 'save' },
          { text: 'Do you ever go in the water?', go: 'water' },
          { text: 'Carry on, Chad.', end: true },
        ],
      },
      party: {
        text: "Cannonball contest, half seven. I'm head judge. Doris is the other judge. Nobody asked her. Nobody ever asks Doris. She's just... there, with a scorecard. Running is still banned. Especially dance-running.",
        choices: [{ text: "I'll be there.", fx: { fun: 4 }, go: 'hub' }],
      },
      judge: {
        text: "Off the board. I score on splash radius, tuck, and how much of it lands on Doris. Doris has never given anyone above a three.",
        choices: [{ text: "You're on.", set: ['chadJudge'], go: 'hub' }],
      },
      save: {
        text: "Gordon. Every day. He won't get out. I've thrown him four rescue rings this week. He's using them as coasters.",
        choices: [{ text: 'Heroic.', fx: { fun: 4 }, go: 'hub' }],
      },
      water: {
        text: "Chad does not go in the water. Chad is the water's... supervisor. You don't see a manager doing the actual work, do you?",
        choices: [{ text: "...That's fair, actually.", fx: { fun: 4, relax: 2 }, go: 'hub' }],
      },
    },
  },

  // --------------------------------------------------------------- DORIS
  doris: {
    name: 'Doris Huxley',
    title: 'Towel strategist (retired)',
    color: '#e0457b',
    start: (s) => (s.flags.metDoris ? 'hub' : 'intro'),
    nodes: {
      intro: {
        text: "Don't sit there. That's reserved. So is that one. And that one. And that one. Walter put the towels down at five-twelve this morning. In the dark. Like a professional.",
        choices: [
          { text: "Four loungers for two people?", set: ['metDoris'], go: 'four' },
          { text: 'Good morning to you too.', set: ['metDoris'], go: 'morning' },
        ],
      },
      four: {
        text: "One for sitting, one for lying, and two for buffer. You never know who'll try to sit next to you. A talker, maybe. Someone who says 'so where are you from'.",
        choices: [{ text: '(say nothing about where you are from)', fx: { fun: 4 }, go: 'hub' }],
      },
      morning: {
        text: "It's a lovely morning. For those of us who secured our position. Walter, say good morning.",
        choices: [{ text: '(Walt, from behind her: "Yes, dear.")', fx: { fun: 5 }, go: 'hub' }],
      },
      hub: {
        text: (s, g) =>
          s.flags.towelPeace
            ? pick(g, 'dorisPeace', [
                "Your lounger's still warm from yesterday. Walter checked. With his hand. I didn't ask him to.",
                "We're on very good terms now, you and I. Don't push it.",
              ])
            : pick(g, 'dorisHub', [
                "A man tried to move one of our towels at eleven. Walter stared at him until he left. Walter is very good at staring.",
                "Thirty-one years of marriage and four sun loungers. That's the secret. Space.",
                "I don't swim. I supervise the pool from a horizontal position.",
              ]),
        choices: [
          { text: "Brenda from Ohio reserves her loungers at five o'clock, you know.", if: (s) => s.flags.metBrenda && !s.flags.towelWar, set: ['towelWar'], go: 'war' },
          { text: 'What if you just... shared one?', if: (s) => !s.flags.towelPeace, go: 'share' },
          { text: "I'll leave you to your empire.", end: true },
        ],
      },
      war: {
        text: "...Five. Five o'clock. She turns slowly to her husband. 'Walter. Set the alarm for four-thirty.' 'Yes, dear.' She looks back at you with the eyes of a general. 'Thank you for the intelligence.'",
        choices: [
          {
            text: '(back away slowly)',
            fx: { fun: 10 },
            act: (g) => g.memory('towel_war', 'Accidentally escalated the Great Towel War between Doris and Brenda. Alarms are now set for 4:30 am.'),
            end: true,
          },
        ],
      },
      share: {
        text: "Share? ...With whom? 'With me.' She looks you up and down for a very long time. Then she slides a towel off the end lounger and folds it into a perfect square. 'Fifteen minutes. Walter will time you.'",
        choices: [
          {
            text: 'Thank you, Doris.',
            set: ['towelPeace'],
            fx: { relax: 10, fun: 6 },
            act: (g) => g.memory('towel_peace', 'Doris let you use one of her reserved loungers. For fifteen minutes. Walter timed it.'),
            end: true,
          },
        ],
      },
    },
  },

  // ---------------------------------------------------------------- WALT
  walt: {
    name: 'Walt Huxley',
    title: 'Husband',
    color: '#7a6a4f',
    start: () => 'hello',
    nodes: {
      hello: {
        text: 'Yes, dear.',
        choices: [
          { text: "...I'm not Doris.", go: 'notdoris' },
          { text: 'Nice safari vest.', go: 'vest' },
          { text: 'Are you enjoying your holiday, Walt?', go: 'holiday' },
        ],
      },
      notdoris: {
        text: "He looks around, slowly, the way a meerkat checks for eagles. '...Yes, dear.'",
        choices: [{ text: 'Right.', fx: { fun: 4 }, end: true }],
      },
      vest: {
        text: "He pats one of its fourteen pockets. There's a whistle in it, a compass, a tin of mints and a laminated map of the pool. 'Yes, dear,' he says, with something like pride.",
        choices: [{ text: '(nod respectfully)', fx: { fun: 4 }, end: true }],
      },
      holiday: {
        text: (s) =>
          s.memories.some((m) => m.id === 'walt')
            ? "He gives you the smallest nod. A man who has said too much once already."
            : "He glances at Doris. She's re-folding a towel. He leans in and whispers: 'I have been on safari in four countries. I have faced down a charging rhinoceros. Nothing prepared me for five a.m. towel duty.' From the lounger: 'WALTER.' He straightens. 'Yes, dear.'",
        choices: [
          {
            text: '(keep his secret)',
            fx: { fun: 8 },
            act: (g) => g.memory('walt', 'Heard Walt Huxley say a full sentence. Possibly his first in years. It was about a rhinoceros.'),
            end: true,
          },
        ],
      },
    },
  },

  // -------------------------------------------------------------- GORDON
  gordon: {
    name: 'Gordon Pratt',
    title: 'Has not left the pool since Tuesday',
    color: '#1f6fb2',
    start: (s) => (s.flags.metGordon ? 'hub' : 'intro'),
    nodes: {
      intro: {
        text: "Ah! A visitor! Come in, come in, the water's lovely. I'd know. I've been in it since Tuesday.",
        choices: [
          { text: 'Since TUESDAY?', set: ['metGordon'], go: 'tuesday' },
          { text: "Is that a Hawaiian shirt? In the pool?", set: ['metGordon'], go: 'shirt' },
        ],
      },
      tuesday: {
        text: "I came in for a quick dip. Then a waiter started bringing drinks to the edge. Then I thought: why would I ever leave? My fingers are permanently pruned. I've reached a new state of being.",
        choices: [{ text: "Don't you have to get out sometimes?", go: 'out' }],
      },
      shirt: {
        text: "It's my swimming shirt. It's also my dinner shirt, my sleeping shirt and, technically, my towel. Very versatile garment. Very wet.",
        choices: [{ text: 'And how long have you been in?', go: 'tuesday' }],
      },
      out: {
        text: "Chad keeps asking me that. I tell him what I tell my wife on the phone: 'Sorry, can't talk, I'm in a meeting.' It's a pool meeting. Very productive. We've decided nothing.",
        choices: [{ text: 'Respect.', fx: { fun: 6 }, go: 'hub' }],
      },
      hub: {
        text: (s, g) =>
          pick(g, 'gordonHub', [
            "Every problem in life can be solved by standing in water up to your chest. I've tested this extensively.",
            "There's a dolphin in the bay who keeps telling me to 'get out more'. Rich, coming from a dolphin.",
            "Doris gave my cannonball a two. I wasn't even doing a cannonball. I'd just sat down.",
            "If you see my wife, I'm in a meeting.",
          ]),
        choices: [
          { text: 'Mind if I join you?', if: (s, g) => g.player.swimming || (g.pool && g.pool.inPool(g.player.pos.x, g.player.pos.z)), go: 'join' },
          { text: 'Mind if I join you?', if: (s, g) => !(g.player.swimming || (g.pool && g.pool.inPool(g.player.pos.x, g.player.pos.z))), go: 'hopin' },
          { text: 'Have you tried the slide?', go: 'slide' },
          { text: 'Enjoy your meeting, Gordon.', end: true },
        ],
      },
      hopin: {
        text: "Hop in first! The steps are at this end. Mind Chad, he's very strict about... everything.",
        choices: [{ text: 'Will do.', go: 'hub' }],
      },
      join: {
        text: "You lean on the edge next to Gordon. He offers you a sip of something orange with an umbrella in it. Together you watch the light wobble on the bottom of the pool and say absolutely nothing useful for a long, long time.",
        choices: [
          {
            text: 'Ahhh.',
            act: (g) => {
              const m = g.mult('gordon');
              g.fx({ relax: 18 * m, fun: 6 * m });
              g.memory('gordon', 'Spent a lazy hour in the pool with Gordon, who has not left it since Tuesday. You understand him now.');
            },
            end: true,
          },
        ],
      },
      slide: {
        text: "Once. Wonderful. Terrifying. I came out of the bottom and simply never left. That was the Tuesday.",
        choices: [{ text: 'Ah.', fx: { fun: 4 }, go: 'hub' }],
      },
    },
  },

  // --------------------------------------------------------------- PHONE
  phone: {
    name: 'Your Phone',
    title: 'bzzt bzzt',
    color: '#555',
    start: () => 'buzz',
    nodes: {
      buzz: {
        text: (s, g) =>
          pick(g, 'phoneMsg', [
            "Your boss: 'Quick question!' (It is never a quick question.)",
            "Your boss: 'No need to respond while you're out, but...'",
            "Calendar: 'Q3 Synergy Alignment Sync' has moved to 'Q3 Synergy Alignment Sync (2).'",
            "Work group chat (47 new): 'who took the stapler'",
            "Your boss: 'Hope you're having a great time!! Also where is the file'",
            "Networking app: 'Congratulate Derek on 6 years at Derek Consulting!'",
            "Your boss: 'Just looping you in so you're in the loop of the loop.'",
          ]),
        choices: [
          { text: 'Read it.', fx: { relax: -12, fun: -2 }, go: 'read' },
          { text: 'Ignore it.', fx: { relax: -2 }, act: (g) => (g.s.phoneIgnores = (g.s.phoneIgnores || 0) + 1), go: 'ignore' },
          { text: 'Bury it in the sand. Forever.', if: (s, g) => g.onSand() && (s.flags.hintBury || (s.phoneIgnores || 0) >= 2), go: 'bury' },
        ],
      },
      read: {
        text: 'You read it. Then the replies. Then the replies to the replies. A perfect wave breaks twenty feet away, unwitnessed.',
        choices: [{ text: '(put it away)', end: true }],
      },
      ignore: { text: 'You put it face-down on your thigh. It vibrates like an angry hermit crab, then gives up. For now.', choices: [{ text: '(ahh)', end: true }] },
      bury: {
        text: 'You dig a hole. You lower the phone in like a tiny Viking funeral. You mark the spot with a shell. Then you move the shell. You will never find it again. You feel like a new person.',
        choices: [
          {
            text: 'Goodbye, little rectangle.',
            act: (g) => {
              g.take('phone');
              g.fx({ relax: 22, fun: 6 });
              g.memory('buried', 'Buried your phone in the sand and lost the spot on purpose.');
            },
            end: true,
          },
        ],
      },
    },
  },
};
