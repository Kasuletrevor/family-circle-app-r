import type { CirclePhotoChoice } from '../../../shared/desktopApi'

/** Profile photos chosen on this computer for people in the active Circle. */
export interface PersonPhotoClient {
  /** Photos by person ID, as image data URLs. */
  listPhotos(): Promise<Record<string, string>>
  choosePhoto(personId: string): Promise<CirclePhotoChoice>
  removePhoto(personId: string): Promise<void>
}
