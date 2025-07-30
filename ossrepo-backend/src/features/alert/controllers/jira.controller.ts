import { Body, Controller, Get, Post, Query, Res } from '@nestjs/common';
import { JiraService } from  '../services/jira.service';
import { Response } from 'express';
import { JiraIssue } from '../dto/jira.dto';

@Controller('jira')
export class JiraController {
  private readonly user: string; // change this when a user login system has been implemented
  constructor(private readonly jiraService: JiraService) {
    this.user = 'user-123';
  }

  @Get('oAuth')
  async jiraAuth( 
    @Query('code') code: string, @Res() res: Response
  ) {
    const record = await this.jiraService.checkTempJiraInfo(code);
    if (!record) {
      return res.status(410).send('Code expired.');
    }
    
    const user = this.user;

    if (!user) {
      // Not logged in: Redirect to login page
      return res.redirect(`/auth/login?code=${code}`);
    }

    return res.redirect(`/jira/user-watchlist?code=${code}`);
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
    @Body() jiraInfo: { code: string, projectKey: string, webtrigger_url: string }) 
  {
    try{
      return this.jiraService.addTempUrl(jiraInfo);
    } catch(err) {
      console.error('connectJira error: ', err);
    }
  }

  @Post('issue')
  createJiraIssue(jiraIssue: {userID: string, summary: string, description: string}) 
  {
    try{
      return this.jiraService.createIssue(jiraIssue);
    } catch(err) {
      console.error('createJiraIssue error: ', err);
    }
  }

  @Get('check-link')
  async checkJiraLink(@Body('insertJira') checkJira: { projectKey: string, webtrigger_url: string} )
  {
    try{
      return await this.jiraService.linkExists(checkJira);
    } catch(err) {
      console.error('checkJiraLink error: ', err);
    }
  }

}
