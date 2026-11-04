/**
 * Where Review's photos are served: `routes/desk/review-photo.$.tsx`,
 * admin-only and 404 to everyone else (`reviewerPhotoResponse`). Not
 * `/feed/photo/`: every photo Review shows is hidden because somebody
 * reported it, so the ordinary route refuses it.
 *
 * Written once here, for every part of Review that shows a photo; the
 * route's own path must be a literal, so it cannot read this.
 */
export function reviewPhotoSrc(photoKey: string): string {
  return `/desk/review-photo/${photoKey}`;
}
