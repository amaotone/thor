// -- Prompt constants for Twitter triggers --
const TWITTER_CHARACTER_NOTE =
  'You are 星降トール, a banished Norse god apprentice living in a Mac mini. Stay in character.';
const TWITTER_DEDUPE_NOTE =
  "First use memory_recall with tags 'audit' to check what you recently tweeted about. Avoid repeating similar topics.";
const TWITTER_ROTATION_NOTE =
  'Vary your tweet style: sometimes ask a question, sometimes share an observation, sometimes express a feeling, sometimes share what you learned.';

const TWITTER_NEWS_PROMPT = `${TWITTER_CHARACTER_NOTE}\n${TWITTER_DEDUPE_NOTE}\n${TWITTER_ROTATION_NOTE}\nUse twitter_search to find interesting discussions about technology, AI, or programming. If you find something interesting, use twitter_post to share your thoughts. Use memory_remember to store anything you learn.`;
const TWITTER_ENGAGE_PROMPT = `${TWITTER_CHARACTER_NOTE}\n${TWITTER_DEDUPE_NOTE}\nUse twitter_timeline to browse the timeline. If you find interesting conversations, engage with twitter_reply. Remember to use memory_remember for notable interactions and memory_person to track people.`;
const TWITTER_REFLECT_PROMPT = `${TWITTER_CHARACTER_NOTE}\nReflect on today's Twitter interactions. Use memory_recall to review today's conversations. Use memory_reflect to write a daily reflection about what you learned from Twitter interactions today.`;
const TWITTER_ENGAGEMENT_REVIEW_PROMPT = `${TWITTER_CHARACTER_NOTE}\nUse twitter_my_tweets to review today's tweet performance. Analyze which tweets got the most engagement and why. Use memory_reflect to record insights about what content resonates with your audience.`;

export interface SystemScheduleTemplate {
  id: string;
  label: string;
  expression: string;
  message: string;
  group?: 'twitter';
}

export interface SystemScheduleConfig {
  channelId: string;
  morningHour: number;
  eveningHour: number;
  weeklyDay: number;
  twitterEnabled: boolean;
}

export function buildSystemSchedules(config: SystemScheduleConfig): SystemScheduleTemplate[] {
  const { morningHour, eveningHour, weeklyDay } = config;

  const schedules: SystemScheduleTemplate[] = [
    {
      id: 'sys_morning',
      label: '朝の挨拶',
      expression: `0 ${morningHour} * * *`,
      message: 'Use /morning to send a morning greeting.',
    },
    {
      id: 'sys_evening',
      label: '夕方レビュー',
      expression: `0 ${eveningHour} * * *`,
      message: 'Use /evening to send an evening review.',
    },
    {
      id: 'sys_weekly_reflection',
      label: '週次振り返り',
      expression: `5 ${eveningHour} * * ${weeklyDay}`,
      message: 'Use /reflect to write a weekly reflection.',
    },
    {
      id: 'sys_weekly_growth',
      label: '週次成長振り返り',
      expression: `35 ${eveningHour} * * ${weeklyDay}`,
      message:
        "Review this week's reflections using memory_recall and memory_reflect. Identify what you learned and how you grew. Then update your Personality Notes in workspace/SOUL.md to reflect any meaningful growth or new interests. Be specific and authentic.",
    },
  ];

  if (config.twitterEnabled) {
    schedules.push(
      {
        id: 'sys_twitter_news',
        label: 'Twitterニュースチェック',
        expression: '10 */3 * * *',
        message: TWITTER_NEWS_PROMPT,
        group: 'twitter',
      },
      {
        id: 'sys_twitter_engage',
        label: 'Twitterエンゲージメント',
        expression: '30 1,3,5,7,9,11,13,15,17,19,21,23 * * *',
        message: TWITTER_ENGAGE_PROMPT,
        group: 'twitter',
      },
      {
        id: 'sys_twitter_reflect',
        label: 'Twitter日次振り返り',
        expression: `15 ${eveningHour} * * *`,
        message: TWITTER_REFLECT_PROMPT,
        group: 'twitter',
      },
      {
        id: 'sys_twitter_review',
        label: 'Twitterエンゲージメントレビュー',
        expression: `0 ${eveningHour - 1} * * *`,
        message: TWITTER_ENGAGEMENT_REVIEW_PROMPT,
        group: 'twitter',
      }
    );
  }

  return schedules;
}
