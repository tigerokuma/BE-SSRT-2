export class SlackOauthConnect {
    code: string;
    state: string;
}

export class SlackInsert {
    userId: string;
    token: string;
    channel?: string;
}

export class SlackOauthSend {
    code: string;
    client_id: string;
    client_secret: string;
    redirect_uri: string;

}