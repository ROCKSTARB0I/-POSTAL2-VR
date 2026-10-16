// The week. Each day is a list of chores; finish them, go home, wake up worse.
export const DAYS = [
  {
    name: 'MONDAY', tag: 'CASH A CHECK',
    tasks: [
      { shop: 'bank', label: 'Cash your paycheck', verb: 'WAIT IN LINE', kind: 'queue', time: 5.0, cash: 240,
        done: 'Two hundred and forty bucks. Try to make it last.' },
      { shop: 'grocery', label: 'Buy milk', verb: 'BUY MILK', kind: 'buy', time: 2.2, cost: 4,
        done: 'Milk. Groundbreaking.' },
      { shop: 'library', label: 'Return the overdue book', verb: 'RETURN BOOK', kind: 'talk', time: 2.0, cost: 12,
        done: 'Twelve dollars in late fees. Worth every page.' },
      { shop: 'home', label: 'Go home and sleep it off', verb: 'GO TO BED', kind: 'end', time: 1.5 },
    ],
  },
  {
    name: 'TUESDAY', tag: 'ERRANDS AND ERRANDS',
    tasks: [
      { shop: 'clinic', label: 'Pick up your prescription', verb: 'WAIT YOUR TURN', kind: 'queue', time: 6.0, cost: 30,
        done: 'These better be the good ones.' },
      { shop: 'hardware', label: 'Buy a shovel', verb: 'BUY SHOVEL', kind: 'buy', time: 2.2, cost: 25, give: 'shovel',
        done: 'A shovel. For the garden. Obviously.' },
      { shop: 'church', label: 'Confess something', verb: 'CONFESS', kind: 'talk', time: 4.0,
        done: 'Feels lighter already. Not much lighter.' },
      { shop: 'home', label: 'Go home and sleep it off', verb: 'GO TO BED', kind: 'end', time: 1.5 },
    ],
  },
  {
    name: 'WEDNESDAY', tag: 'PAPERWORK DAY',
    tasks: [
      { shop: 'postoffice', label: 'Mail the package', verb: 'WAIT AT THE WINDOW', kind: 'queue', time: 7.0, cost: 18,
        done: 'Eighteen dollars to move a box eleven blocks.' },
      { shop: 'police', label: 'Pay the parking ticket', verb: 'PAY THE FINE', kind: 'queue', time: 5.5, cost: 60,
        done: 'Sixty dollars. For parking. On my own street.' },
      { shop: 'bar', label: 'Have a drink about it', verb: 'ORDER A DRINK', kind: 'buy', time: 3.5, cost: 15, heal: 45,
        done: 'That is better. That is much better.' },
      { shop: 'home', label: 'Go home and sleep it off', verb: 'GO TO BED', kind: 'end', time: 1.5 },
    ],
  },
  {
    name: 'THURSDAY', tag: 'PERMITS AND AUTOGRAPHS',
    tasks: [
      { shop: 'gunshop', label: 'Collect your gun permit', verb: 'FILE THE PERMIT', kind: 'queue', time: 5.0, cost: 80, give: 'pistol',
        done: 'Licensed. Everything from here is basically paperwork.' },
      { shop: 'mall', label: 'Get an autograph from somebody famous', verb: 'GET AUTOGRAPH', kind: 'talk', time: 4.5,
        done: 'Could not tell you who that was.' },
      { shop: 'grocery', label: 'Buy dog food', verb: 'BUY DOG FOOD', kind: 'buy', time: 2.2, cost: 9,
        done: 'The dog eats better than I do.' },
      { shop: 'home', label: 'Go home and sleep it off', verb: 'GO TO BED', kind: 'end', time: 1.5 },
    ],
  },
  {
    name: 'FRIDAY', tag: 'THE LAST ERRAND',
    tasks: [
      { shop: 'bank', label: 'Withdraw everything', verb: 'EMPTY THE ACCOUNT', kind: 'queue', time: 6.0, cash: 500,
        done: 'Every cent I have. Feels appropriate.' },
      { shop: 'gunshop', label: 'Pick up your order', verb: 'COLLECT ORDER', kind: 'buy', time: 3.0, cost: 300, give: 'shotgun',
        done: 'For home defence. My home. Everyone else\'s defence.' },
      { shop: 'mall', label: 'Buy the game', verb: 'BUY THE GAME', kind: 'buy', time: 3.0, cost: 60,
        done: 'Sold out. Of course it is. Take the display copy.' },
      { shop: 'home', label: 'Go home. Week over.', verb: 'FINISH THE WEEK', kind: 'end', time: 2.0 },
    ],
  },
];

export const INTRO_LINES = [
  'Monday. The list is on the fridge. Same as it ever was.',
  'Tuesday. Pills, a shovel, and forgiveness. In that order.',
  'Wednesday. Nothing but windows and waiting.',
  'Thursday. Paperwork, celebrities, kibble.',
  'Friday. Last day. Then the week is somebody else\'s problem.',
];

