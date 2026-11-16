const ADJECTIVES = [
  'agile', 'amber', 'amiable', 'bold', 'brave', 'breezy', 'bright', 'brisk', 'bubbly', 'calm',
  'candid', 'cheerful', 'cheery', 'chipper', 'classic', 'clever', 'cosmic', 'cozy', 'crisp', 'curious',
  'dapper', 'daring', 'dazzling', 'diabolical', 'dreamy', 'dynamic', 'eager', 'earnest', 'elegant', 'epic',
  'fancy', 'fearless', 'festive', 'fluffy', 'fresh', 'friendly', 'fuzzy', 'gallant', 'gentle', 'giddy',
  'gleaming', 'glossy', 'golden', 'graceful', 'grand', 'groovy', 'happy', 'hearty', 'heroic', 'honest',
  'humble', 'jaunty', 'jolly', 'jovial', 'joyful', 'jubilant', 'keen', 'kind', 'lively', 'lucky',
  'luminous', 'magical', 'majestic', 'mellow', 'merry', 'mighty', 'modest', 'nifty', 'nimble', 'noble',
  'peppy', 'playful', 'plucky', 'polished', 'proud', 'quick', 'quiet', 'quirky', 'radiant', 'rapid',
  'rosy', 'rustic', 'serene', 'shiny', 'silky', 'snappy', 'snug', 'sparkly', 'spirited', 'splendid',
  'sporty', 'stellar', 'sturdy', 'sunny', 'swift', 'tidy', 'upbeat', 'valiant', 'velvety', 'vibrant',
  'vivid', 'warm', 'whimsical', 'witty', 'zany', 'zesty'
]

const ANIMALS = [
  'alpaca', 'antelope', 'badger', 'bison', 'bluebird', 'bobcat', 'bumblebee', 'bunny', 'butterfly', 'canary',
  'capybara', 'chameleon', 'cheetah', 'chickadee', 'chinchilla', 'chipmunk', 'crane', 'cricket', 'dolphin', 'dove',
  'dragonfly', 'duckling', 'eagle', 'elephant', 'emu', 'falcon', 'fawn', 'finch', 'firefly', 'flamingo',
  'foal', 'fox', 'gazelle', 'gecko', 'gibbon', 'giraffe', 'goldfish', 'goose', 'gorilla', 'gosling',
  'hamster', 'hare', 'hedgehog', 'heron', 'hippo', 'honeybee', 'ibex', 'impala', 'jaguar', 'kangaroo',
  'kitten', 'koala', 'ladybug', 'lamb', 'lemur', 'leopard', 'lion', 'llama', 'lynx', 'macaw',
  'manatee', 'marmot', 'meerkat', 'moose', 'narwhal', 'octopus', 'orca', 'ostrich', 'otter', 'owl',
  'panda', 'panther', 'parrot', 'pelican', 'penguin', 'piglet', 'platypus', 'pony', 'porcupine', 'puffin',
  'puppy', 'quokka', 'rabbit', 'raccoon', 'raven', 'reindeer', 'robin', 'salamander', 'seahorse', 'seal',
  'sparrow', 'squirrel', 'starfish', 'starling', 'stork', 'swan', 'tiger', 'tortoise', 'toucan', 'turtle',
  'walrus', 'wombat', 'wren', 'zebra'
]

const FRUITS = [
  'acerola', 'ackee', 'apple', 'apricot', 'avocado', 'banana', 'barberry', 'bergamot', 'bilberry', 'blackberry',
  'blueberry', 'breadfruit', 'calamansi', 'cantaloupe', 'carambola', 'cherimoya', 'cherry', 'citron', 'clementine', 'cloudberry',
  'coconut', 'cranberry', 'crowberry', 'currant', 'damson', 'date', 'dewberry', 'elderberry', 'feijoa', 'fig',
  'goji', 'gooseberry', 'grape', 'grapefruit', 'greengage', 'guava', 'haskap', 'honeyberry', 'honeydew', 'jabuticaba',
  'jackfruit', 'jostaberry', 'jujube', 'juneberry', 'kiwano', 'kiwi', 'kumquat', 'lemon', 'lime', 'loganberry',
  'longan', 'loquat', 'lucuma', 'lychee', 'mamey', 'mandarin', 'mango', 'mangosteen', 'marula', 'mirabelle',
  'morello', 'mulberry', 'muscadine', 'nectarine', 'olive', 'orange', 'papaya', 'pawpaw', 'pear', 'pepino',
  'persimmon', 'pineapple', 'pitanga', 'pitaya', 'plantain', 'plum', 'pomelo', 'quandong', 'quince', 'raisin',
  'rambutan', 'raspberry', 'redcurrant', 'rosehip', 'rowanberry', 'salak', 'sapodilla', 'saskatoon', 'satsuma', 'sloe',
  'soursop', 'starfruit', 'strawberry', 'sugarapple', 'tamarillo', 'tamarind', 'tangelo', 'tangerine', 'tayberry', 'watermelon',
  'wolfberry', 'youngberry', 'yuzu'
]

export const SHOT_NAME_WORDS = { adjectives: ADJECTIVES, animals: ANIMALS, fruits: FRUITS }

const SHOT_NAME = /^[a-z]{1,10}-[a-z]{1,10}-[a-z]{1,10}$/

export const isShotName = (value: unknown): value is string => typeof value === 'string' && SHOT_NAME.test(value)

const pick = (words: string[], random: () => number) => words[Math.min(words.length - 1, Math.floor(random() * words.length))]

/** An adjective, an animal and a fruit, like `diabolical-elephant-strawberry`. */
export const randomShotName = (random: () => number = Math.random) => `${pick(ADJECTIVES, random)}-${pick(ANIMALS, random)}-${pick(FRUITS, random)}`

/** A random name that isn't `taken`: it draws again on a collision. */
export function uniqueShotName(taken: ReadonlySet<string>, random: () => number = Math.random): string {
  let name = randomShotName(random)
  while (taken.has(name)) name = randomShotName(random)
  return name
}

/** Shots keep the names they ask for, the first of any repeated one included; the others, and shots without one, get fresh names. */
export function settledShotNames(requested: readonly (string | null)[], random: () => number = Math.random): string[] {
  const kept = requested.map((name, index) => (name !== null && requested.indexOf(name) === index ? name : null))
  const taken = new Set(kept.filter((name) => name !== null))
  return kept.map((name) => {
    if (name !== null) return name
    const fresh = uniqueShotName(taken, random)
    taken.add(fresh)
    return fresh
  })
}
