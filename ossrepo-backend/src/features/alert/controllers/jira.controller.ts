import { Body, Controller, Get, Param, Post, Query, Res } from '@nestjs/common';
import { JiraService } from  '../services/jira.service';
import { Response } from 'express';
import { JiraIssue } from '../dto/jira.dto';

@Controller('jira')
export class JiraController {
  constructor(private readonly jiraService: JiraService) {}

  @Get('oAuth/:user_id')
  async jiraAuth(
    @Query('code') code: string, 
    @Param('user_id') user_id: string,
    @Res() res: Response
  ) {
    const record = await this.jiraService.checkTempJiraInfo(code);
    if (record==null) {
      console.log("expir");
      return res.status(410).send('Code expired.');
    }
  

    if (!user_id) {
      // Not logged in: Redirect to login page
      const redirectAfterLogin = `/jira/oAuth?code=${code}`;
      return res.redirect(`/auth/login?redirectUrl=${encodeURIComponent(redirectAfterLogin)}`);
    }

    const insertJira = { user_id, code };
    await this.jiraService.linkProject(insertJira);

    return res.json({ id: user_id });
  }

  @Get('gen-code')
  async genCode(){
    return await this.jiraService.generateCode();
  }

  @Post('link')
  async linkJira(
    @Body('insertJira') insertJira: { user_id: string, code: string}
  ) {
    return this.jiraService.linkProject(insertJira)
  }

  @Post('insert-code')
  async codeJira(
    @Body() jiraInfo: { code: string, projectKey: string, webtriggerUrl: string }) 
  {
    try{
      return this.jiraService.addTempUrl(jiraInfo);
    } catch(err) {
      console.error('connectJira error: ', err);
    }
  }

  @Post('issue')
  createJiraIssue(@Body() jiraIssue: {userID: string, summary: string, description: string}) 
  {
    try{
      return this.jiraService.createIssue(jiraIssue);
    } catch(err) {
      console.error('createJiraIssue error: ', err);
    }
  }

  @Get('user-info/:user_id')
  async getJiraInfo(@Param('user_id') user_id: string) {
    return await this.jiraService.getUserInfo(user_id);
  }

  @Post('check-link')
  async checkJiraLink(@Body() checkJira: { projectKey: string, webtrigger_url: string} )
  {
    try{
      return await this.jiraService.linkExists(checkJira);
    } catch(err) {
      console.error('checkJiraLink error: ', err);
    }
  }

}
