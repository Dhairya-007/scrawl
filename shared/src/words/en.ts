/** English word pool. Plain, drawable nouns and a few easy verbs. */
export const EN_WORDS: string[] = [
  // Animals
  'cat', 'dog', 'horse', 'cow', 'sheep', 'goat', 'pig', 'chicken', 'duck', 'goose',
  'eagle', 'owl', 'penguin', 'ostrich', 'peacock', 'parrot', 'flamingo', 'pelican',
  'shark', 'whale', 'dolphin', 'octopus', 'jellyfish', 'crab', 'lobster', 'starfish',
  'seahorse', 'turtle', 'frog', 'snake', 'lizard', 'crocodile', 'dinosaur', 'dragon',
  'lion', 'tiger', 'bear', 'panda', 'koala', 'kangaroo', 'elephant', 'giraffe',
  'zebra', 'rhino', 'hippo', 'monkey', 'gorilla', 'sloth', 'camel', 'llama',
  'squirrel', 'hedgehog', 'rabbit', 'mouse', 'bat', 'fox', 'wolf', 'deer',
  'bee', 'ant', 'spider', 'butterfly', 'ladybug', 'snail', 'worm', 'scorpion',
  // Food and drink
  'apple', 'banana', 'orange', 'lemon', 'grapes', 'strawberry', 'pineapple', 'watermelon',
  'coconut', 'avocado', 'cherry', 'peach', 'mango', 'carrot', 'potato', 'tomato',
  'onion', 'garlic', 'mushroom', 'broccoli', 'corn', 'pumpkin', 'chilli', 'cucumber',
  'bread', 'toast', 'butter', 'cheese', 'egg', 'bacon', 'sausage', 'burger',
  'pizza', 'taco', 'sandwich', 'noodles', 'rice', 'soup', 'salad', 'sushi',
  'pancake', 'waffle', 'donut', 'cupcake', 'cake', 'cookie', 'chocolate', 'lollipop',
  'ice cream', 'popcorn', 'pretzel', 'honey', 'jam', 'milk', 'coffee', 'tea',
  // Home and objects
  'chair', 'table', 'sofa', 'bed', 'pillow', 'blanket', 'lamp', 'candle',
  'mirror', 'clock', 'calendar', 'window', 'door', 'key', 'lock', 'ladder',
  'broom', 'bucket', 'mop', 'soap', 'toothbrush', 'towel', 'bathtub', 'shower',
  'kettle', 'teapot', 'mug', 'spoon', 'fork', 'knife', 'plate', 'bowl',
  'fridge', 'oven', 'toaster', 'blender', 'microwave', 'washing machine', 'vacuum', 'iron',
  'scissors', 'stapler', 'pencil', 'pen', 'eraser', 'ruler', 'notebook', 'envelope',
  'stamp', 'glue', 'tape', 'paperclip', 'battery', 'lightbulb', 'magnet', 'funnel',
  'hammer', 'screwdriver', 'wrench', 'saw', 'drill', 'nail', 'screw', 'toolbox',
  'umbrella', 'suitcase', 'backpack', 'wallet', 'purse', 'basket', 'box', 'jar',
  'bottle', 'can', 'straw', 'balloon', 'kite', 'rope', 'chain', 'anchor',
  // Clothes
  'hat', 'cap', 'crown', 'helmet', 'scarf', 'glove', 'mitten', 'sock',
  'shoe', 'boot', 'sandal', 'skate', 'shirt', 'jacket', 'coat', 'sweater',
  'dress', 'skirt', 'jeans', 'shorts', 'belt', 'tie', 'button', 'zipper',
  'glasses', 'sunglasses', 'watch', 'ring', 'necklace', 'earring', 'mask', 'apron',
  // Transport
  'car', 'bus', 'truck', 'van', 'taxi', 'tractor', 'bulldozer', 'crane',
  'bicycle', 'motorbike', 'scooter', 'skateboard', 'train', 'tram', 'subway', 'trolley',
  'boat', 'ship', 'canoe', 'raft', 'submarine', 'jet ski', 'sailboat', 'ferry',
  'plane', 'helicopter', 'rocket', 'hot air balloon', 'parachute', 'glider', 'ufo', 'sled',
  // Nature
  'tree', 'leaf', 'flower', 'rose', 'sunflower', 'cactus', 'bush', 'grass',
  'mountain', 'volcano', 'island', 'beach', 'desert', 'forest', 'cave',
  'river', 'waterfall', 'lake', 'ocean', 'wave', 'iceberg', 'glacier', 'swamp',
  'sun', 'moon', 'star', 'cloud', 'rain', 'snow', 'lightning', 'rainbow',
  'tornado', 'hurricane', 'fog', 'icicle', 'puddle', 'rock', 'sand', 'mud',
  'planet', 'comet', 'galaxy', 'eclipse', 'meteor', 'satellite', 'telescope', 'constellation',
  // Buildings and places
  'house', 'castle', 'tower', 'bridge', 'lighthouse', 'windmill', 'barn', 'tent',
  'igloo', 'treehouse', 'skyscraper', 'church', 'temple', 'pyramid', 'stadium', 'museum',
  'school', 'hospital', 'library', 'bakery', 'market', 'farm', 'zoo', 'airport',
  'bank', 'prison', 'hotel', 'restaurant', 'cinema', 'playground', 'park', 'fountain',
  // Music and art
  'guitar', 'piano', 'violin', 'drum', 'trumpet', 'flute', 'saxophone', 'harp',
  'accordion', 'banjo', 'tambourine', 'microphone', 'headphones', 'speaker', 'radio', 'record',
  'paintbrush', 'palette', 'easel', 'canvas', 'crayon', 'sculpture', 'mosaic', 'origami',
  // Sport and games
  'football', 'basketball', 'tennis', 'baseball', 'golf', 'hockey', 'cricket', 'rugby',
  'bowling', 'archery', 'boxing', 'surfing', 'skiing', 'diving', 'climbing', 'fishing',
  'chess', 'dice', 'cards', 'puzzle', 'dartboard', 'yoyo', 'marble', 'trophy',
  'medal', 'whistle', 'net', 'racket', 'goalpost', 'scoreboard', 'treadmill', 'dumbbell',
  // People and jobs
  'doctor', 'nurse', 'teacher', 'chef', 'baker', 'farmer', 'pilot', 'sailor',
  'firefighter', 'police', 'postman', 'builder', 'plumber', 'painter', 'barber', 'dentist',
  'scientist', 'astronaut', 'diver', 'juggler', 'clown', 'magician', 'knight', 'pirate',
  'wizard', 'witch', 'ghost', 'vampire', 'zombie', 'robot', 'alien', 'mermaid',
  'giant', 'elf', 'fairy', 'troll', 'yeti', 'genie', 'mummy', 'scarecrow',
  // Body
  'eye', 'ear', 'nose', 'mouth', 'tooth', 'tongue', 'hand', 'foot',
  'finger', 'thumb', 'elbow', 'knee', 'shoulder', 'heart', 'brain', 'bone',
  'skeleton', 'hair', 'beard', 'moustache', 'eyebrow', 'freckles', 'fingerprint', 'footprint',
  // Technology
  'computer', 'laptop', 'keyboard', 'mouse pad', 'monitor', 'printer', 'camera', 'phone',
  'tablet', 'joystick', 'console', 'cable', 'plug', 'antenna', 'drone', 'elevator',
  'escalator', 'traffic light', 'streetlight', 'mailbox', 'signpost', 'fire hydrant', 'bench', 'fence',
  // Actions and ideas
  'sleeping', 'running', 'swimming', 'dancing', 'singing', 'laughing', 'crying', 'sneezing',
  'yawning', 'jumping', 'falling', 'hugging', 'waving', 'whispering', 'reading', 'writing',
  'cooking', 'cleaning', 'shopping', 'camping', 'gardening', 'hiking', 'skating', 'bowling pin',
  'birthday', 'wedding', 'parade', 'picnic', 'fireworks', 'carnival', 'circus', 'party',
  'treasure', 'map', 'compass', 'hourglass', 'scales', 'lantern', 'potion', 'spellbook',
  'heartbeat', 'shadow', 'reflection', 'echo', 'bubble', 'smoke', 'flame', 'spark',
];
