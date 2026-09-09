// Original file: proto/animation_stream.proto

export const GenreTemplate = {
  GENRE_GENERIC: 0,
  GENRE_PLATFORMER: 1,
  GENRE_FPS: 2,
  GENRE_ACTION_RPG: 3,
  GENRE_VEHICLE: 4,
} as const;

export type GenreTemplate =
  | 'GENRE_GENERIC'
  | 0
  | 'GENRE_PLATFORMER'
  | 1
  | 'GENRE_FPS'
  | 2
  | 'GENRE_ACTION_RPG'
  | 3
  | 'GENRE_VEHICLE'
  | 4

export type GenreTemplate__Output = typeof GenreTemplate[keyof typeof GenreTemplate]
