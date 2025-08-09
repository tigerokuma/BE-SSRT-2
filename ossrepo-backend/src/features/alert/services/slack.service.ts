import { Injectable } from "@nestjs/common";
import axios from 'axios';
import { SlackRepository } from "../repositories/slack.repository";
import { SlackOauthSend } from "../dto/slack.dto";

@Injectable()
export class SlackService{
    private readonly clientId: string;
    private readonly clientSecret: string;
    private readonly redirectUrl: string;

    constructor(
        private slackRepository: SlackRepository,
    ) {
        this.clientId = process.env.SLACK_CLIENT_ID!;
        this.clientSecret = process.env.SLACK_CLIENT_SECRET!;
        this.redirectUrl = process.env.SLACK_REDIRECT_URL!;
    }

    async exchangeCodeForToken(code: string, state: string): Promise<string> {
        try {
            if (!(await this.slackRepository.getUserById(state))) {
                throw new Error('Invalid or expired state token');
            }

            const slackOauthSend = new SlackOauthSend();
            slackOauthSend.code = code;
            slackOauthSend.client_id = this.clientId;
            slackOauthSend.client_secret = this.clientSecret;
            slackOauthSend.redirect_uri = this.redirectUrl;

            const response = await axios.post(
            'https://slack.com/api/oauth.v2.access',
            new URLSearchParams(Object.entries(slackOauthSend)),
            {
                headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            }
            );

            if (!response.data.ok) {
                throw new Error(`Slack OAuth error: ${response.data.error}`);
            }
            
            this.slackRepository.insertSlackInfo({
                userId: state,
                token: response.data.access_token,
            })

            return response.data.access_token;
        }catch(err) {
            console.error('Failed to add slack workspace.');
            return err;
        }


    }

    async getChannels(uwlId: string) { 
        try {
            const token = await this.slackRepository.getSlackInfo(uwlId);
            const response = await axios.get('https://slack.com/api/conversations.list', {
                headers: {
                Authorization: `Bearer ${token?.slack_token}`,
                },
                params: {
                exclude_archived: true,
                limit: 10,
                types: 'public_channel',
                },
            });

            if (!response.data.ok) {
                throw new Error(`Slack API error: ${response.data.error}`);
            }
            return response.data.channels;
        } catch (err) {
            console.error('Failed to fetch Slack channels:', err.message);
        }
    }

    getOAuthUrl(uwlId: string) {
        const slackUrl = new URL('https://slack.com/oauth/v2/authorize');
        slackUrl.searchParams.set('client_id', this.clientId);
        slackUrl.searchParams.set('scope', 'chat:write, channels:read, channels:join, channels:manage');
        slackUrl.searchParams.set('redirect_uri', this.redirectUrl);
        slackUrl.searchParams.set('state', uwlId);

        return slackUrl.toString();
    }

    async joinChannel(uwlId: string, text: string) {
        try{
            const token = await this.slackRepository.getSlackInfo(uwlId);
            const response = await axios.post(
            'https://slack.com/api/conversations.join',
            { channel: text },
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
                userId: uwlId, 
                token: token!.slack_token,
                channel: text
            });

            return response.data.channel;
        } catch (err) {
            console.error('Failed to join Slack channel:', err.message);
        }

    }

    async getSlackChannel(user_id: string) {
        try {
            const slackInfo = await this.slackRepository.getSlackInfo(user_id);
            const response = await axios.get('https://slack.com/api/conversations.info', {
                headers: {
                Authorization: `Bearer ${slackInfo?.slack_token}`,
                },
                params: {
                    channel: slackInfo?.slack_channel,
                },

            });

            if (!response.data.ok) {
                throw new Error(`Slack API error: ${response.data.error}`);
            }
            console.log(response.data.channel.name);
            return { name: response.data.channel.name };
        } catch (error) {
            throw new Error(`Error fetching channel name: ${error.message}`);
        }
    }

    async sendMessage(uwlId: string, text: string) {
        try {
            const repo = await this.slackRepository.getSlackInfo(uwlId);
            const response = await axios.post(
                'https://slack.com/api/chat.postMessage',
                {
                channel: repo?.slack_channel,
                text: text,
                },
                {
                headers: {
                    Authorization: `Bearer ${repo?.slack_token}`,
                    'Content-Type': 'application/json',
                },
                },
            );

            if (!response.data.ok) {
                throw new Error(`Slack API error: ${response.data.error}`);
            }
        } catch (err) {
            console.error('Failed to send message:', err.message);
        }

    }

}