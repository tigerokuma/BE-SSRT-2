import { Injectable } from "@nestjs/common";
import axios from 'axios';
import { SlackRepository } from "../repositories/slack.repository";
import { SlackOauthSend } from "../dto/slack.dto";


@Injectable()
export class SlackService{
    constructor(private slackRepository: SlackRepository) {}

    async exchangeCodeForToken(code: string): Promise<string> {
        const clientId = process.env.SLACK_CLIENT_ID;
        const clientSecret = process.env.SLACK_CLIENT_SECRET;
        const redirectUrl = process.env.SLACK_REDIRECT_URL;

        if (!clientId || !clientSecret || !redirectUrl) {
            throw new Error('SLACK_CLIENT_ID is not set in .env');
        }

        const slackOauthSend = new SlackOauthSend();
        slackOauthSend.code = code;
        slackOauthSend.client_id = clientId;
        slackOauthSend.client_secret = clientSecret;
        slackOauthSend.redirect_uri = redirectUrl;


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
            userId: '1',
            token: response.data.access_token,
        })

        return response.data.access_token;

    }

    async getChannels(body: any) { 
        try {
            const token = await this.slackRepository.getSlackInfo('1');
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

    async joinChannel(text: string) {
        try{
            const token = await this.slackRepository.getSlackInfo('1');
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
                userId: '1', 
                token: token!.slack_token,
                channel: text
            });

            return response.data.channel;
        } catch (err) {
            console.error('Failed to join Slack channel:', err.message);
        }

    }

    async sendMessage(text: string) {
        try {
            const repo = await this.slackRepository.getSlackInfo('1');
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