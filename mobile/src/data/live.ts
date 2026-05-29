import type { Batch, CalendarItem, Page, Photo, StyleHistoryEntry } from '@cadencia/shared';
import {
  describeApiError,
  fetchBatches,
  fetchCalendar,
  fetchPage,
  fetchPages,
  fetchPhotos,
  fetchStyleHistory,
  isMetaAuthError,
} from '../api';
import {
  demoPages,
  getCalendarForPage,
  getPage,
  getPhotosForPage,
  getStyleHistoryForPage,
} from './demo';

export type DataSource = 'meta' | 'demo';

export type PageListResult = {
  authRequired?: boolean;
  pages: Page[];
  source: DataSource;
  notice?: string;
};

export type PageBundle = {
  page?: Page;
  batches: Batch[];
  photos: Photo[];
  calendar: CalendarItem[];
  styleHistory: StyleHistoryEntry[];
  source: DataSource;
  notice?: string;
};

export async function loadPages(): Promise<PageListResult> {
  try {
    const pages = await fetchPages();

    if (pages.length === 0) {
      return {
        pages: demoPages,
        source: 'demo',
        notice: 'Meta respondio sin paginas. Mostrando datos de muestra.',
      };
    }

    return {
      pages,
      source: 'meta',
    };
  } catch (error) {
    return {
      authRequired: isMetaAuthError(error),
      pages: demoPages,
      source: 'demo',
      notice: describeApiError(error),
    };
  }
}

export async function loadPageBundle(pageId: string): Promise<PageBundle> {
  try {
    const [page, photos, calendar, styleHistory] = await Promise.all([
      fetchPage(pageId),
      fetchPhotos(pageId),
      fetchCalendar(pageId),
      fetchStyleHistory(pageId),
    ]);
    const batches = await fetchBatches(page.id);

    return {
      batches,
      page,
      photos,
      calendar,
      styleHistory,
      source: page.id.startsWith('meta-') ? 'meta' : 'demo',
    };
  } catch (error) {
    const fallback = demoBundle(pageId, describeApiError(error));

    if (fallback.page) {
      return fallback;
    }

    return {
    photos: [],
    batches: [],
      calendar: [],
      styleHistory: [],
      source: 'demo',
      notice: describeApiError(error),
    };
  }
}

function demoBundle(pageId: string, notice?: string): PageBundle {
  return {
    batches: [],
    page: getPage(pageId),
    photos: getPhotosForPage(pageId),
    calendar: getCalendarForPage(pageId),
    styleHistory: getStyleHistoryForPage(pageId),
    source: 'demo',
    notice,
  };
}
