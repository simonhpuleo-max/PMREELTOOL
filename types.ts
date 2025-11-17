
export interface NewsItem {
  headline: string;
  date: string;
  source: string;
  summary: string;
}

export interface Script {
  detailedScript: {
    hook: string;
    development: string;
    cta: string;
  };
  cleanAudioText: string;
  suggestions: {
    title: string;
    hashtags: string[];
    thumbnailIdea: string;
  };
}
