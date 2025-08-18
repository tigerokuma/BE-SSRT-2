import { Injectable, Logger } from "@nestjs/common";
import axios from 'axios';
import { SlackRepository } from "../repositories/slack.repository";
import { SlackOauthConnect, UserChannel, UserMessage } from "../dto/slack.dto";

@Injectable()
export class SlackService{
    private readonly clientId: string;
    private readonly clientSecret: string;
    private readonly redirectUrl: string;
    private readonly frontendUrl: string;

    constructor(
        private slackRepository: SlackRepository,
    ) {
        this.clientId = process.env.SLACK_CLIENT_ID!;
        this.clientSecret = process.env.SLACK_CLIENT_SECRET!;
        this.redirectUrl = process.env.SLACK_REDIRECT_URL!;
        this.frontendUrl = process.env.FRONTEND_URL!;
    }

    async exchangeCodeForToken(slackOauthConnect: SlackOauthConnect) {
        if (!(await this.slackRepository.getUserById(slackOauthConnect.state))) {
            throw new Error('Invalid or expired state token');
        }

        const slackOauthSend = {
            code : slackOauthConnect.code,
            client_id : this.clientId,
            client_secret : this.clientSecret,
            redirect_uri : this.redirectUrl,
        };
            

        const response = await axios.post(
            'https://slack.com/api/oauth.v2.access',
            new URLSearchParams(Object.entries(slackOauthSend)), { 
                headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            }
        );

        if (!response.data.ok) {
            throw new Error(`Slack OAuth error: ${response.data.error}`);
        }
        
        this.slackRepository.insertSlackInfo({
            user_id: slackOauthConnect.state,
            token: response.data.access_token,
        })
    }

    async getChannels(user_id: string) { 
        const token = await this.slackRepository.getSlackInfoUser(user_id);
        const response = await axios.get('https://slack.com/api/conversations.list', {
            headers: { Authorization: `Bearer ${token?.slack_token}` },
            params: {
                exclude_archived: true,
                limit: 10,
                types: 'public_channel',
            },
        });

        if (!response.data.ok) {
            throw new Error(`Slack API error: ${response.data.error}`);
        }
        return { channels: response.data.channels };
    }

    getOAuthUrl(user_id: string) {
        const slackUrl = new URL('https://slack.com/oauth/v2/authorize');
        slackUrl.searchParams.set('client_id', this.clientId);
        slackUrl.searchParams.set('scope', 'chat:write, channels:read, channels:join, channels:manage');
        slackUrl.searchParams.set('redirect_uri', this.redirectUrl);
        slackUrl.searchParams.set('state', user_id);

        return slackUrl.toString();
    }

    async joinChannel(userChannel: UserChannel) {
        const token = await this.slackRepository.getSlackInfoUser(userChannel.user_id);
        const response = await axios.post(
            'https://slack.com/api/conversations.join',
            { channel: userChannel.channel },
            {
                headers: {
                    Authorization: `Bearer ${token?.slack_token}`,
                    'Content-Type': 'application/json',
                },
            },
        );

        if (!response.data.ok) {
            throw new Error(`Slack API error: ${response.data.error}`);
        }
        this.slackRepository.insertSlackInfo({
            user_id: userChannel.user_id, 
            token: token!.slack_token,
            channel: userChannel.channel
        });

        return { channel: response.data.channel };
    }

    async getSlackChannel(user_id: string) {
        const slackInfo = await this.slackRepository.getSlackInfoUser(user_id);
        
        if(!slackInfo?.slack_channel) {
            return {};
        }

        const response = await axios.get('https://slack.com/api/conversations.info', {
            headers: { Authorization: `Bearer ${slackInfo?.slack_token}` },
            params: { channel: slackInfo?.slack_channel },
        });

        if (!response.data.ok) {
            throw new Error(`Slack API error: ${response.data.error}`);
        }

        return { name: response.data.channel.name };
    }

    async sendMessage(userMessage: UserMessage) {
        try {
            const slackInfo = await this.slackRepository.getSlackInfoUserWatch(userMessage.user_watchlist_id);
            const package_name = await this.slackRepository.getPackageName(userMessage.user_watchlist_id);

            const response = await axios.post(
                'https://slack.com/api/chat.postMessage',
                {
                    channel: slackInfo?.slack_channel,
                    blocks: [
                        {
                            type: "header",
                            text: {
                                type: "plain_text",
                                text: `New alert in ${package_name}`,
                            }
                        },
                        {
                            type: "section",
                            text: {
                                type: "mrkdwn",
                                text: userMessage.description
                            }
                        },
                        {
                            type: "section",
                            text: {
                                type: "mrkdwn",
                                text: `<${this.frontendUrl}/package-details?id=${userMessage.user_watchlist_id}>`
                            }
                        }
                    ]
                },
                {
                    headers: {
                        Authorization: `Bearer ${slackInfo?.slack_token}`,
                        'Content-Type': 'application/json',
                    },
                },
            );

            if (!response.data.ok) {
                throw new Error(`Slack API error: ${response.data.error}`);
            }
        } catch (err) {
            Logger.error("Slack message failed to send.", err);
        }

    }

}