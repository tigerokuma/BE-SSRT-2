import type { OsvVulnerability } from '../services/osv-vulnerability.service';

// Clean DTOs for package responses
// PackageCardDto: NPM data only - used for search results and summary view
export class PackageCardDto {
    name: string;
    description: string;
    keywords: string[];
    downloads: number;
    maintainers: string[];
    last_updated: string;
    version: string;
    license: string;
    osv_vulnerabilities?: OsvVulnerability[];
  }
  
  // PackageDetailsDto: NPM + GitHub data - used for details view
  export class PackageDetailsDto extends PackageCardDto {
    package_id: string;
    published: string;
    published_at: Date;
    repo_url?: string;
    repo_name?: string;
    risk_score: number;
    npm_url: string;
    homepage?: string;
    
    // GitHub fields (optional - may not be available if GitHub API fails)
    stars?: number;
    forks?: number;
    contributors?: number;
  } 