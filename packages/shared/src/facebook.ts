import type { FacebookTokenStatus } from "./states";

export interface FacebookPageConnection {
  pageId: string;
  pageName: string;
  pageAccessTokenStatus: FacebookTokenStatus;
  coverPhotoUrl?: string | null;
  isSelected: boolean;
  category?: string | null;
  categoryList?: Array<{ id?: string; name?: string }> | null;
  tasks?: string[] | null;
}

export interface PublishPostData {
  pageId: string;
  message: string;
  imageUrl?: string | null;
  scheduledFor?: string | null;
}

export interface FacebookMetricsData {
  reach: number;
  reactions: number;
  comments: number;
  shares: number;
  saves: number;
}
