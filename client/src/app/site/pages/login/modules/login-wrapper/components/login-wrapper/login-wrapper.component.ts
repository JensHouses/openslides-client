import { Component, OnInit } from '@angular/core';
import { TranslateService } from '@ngx-translate/core';
import { BaseComponent } from 'src/app/site/base/base.component';
import { ComponentServiceCollectorService } from 'src/app/site/services/component-service-collector.service';
import { LifecycleService } from 'src/app/site/services/lifecycle.service';

@Component({
    selector: `os-login-wrapper`,
    templateUrl: `./login-wrapper.component.html`,
    styleUrls: [`./login-wrapper.component.scss`]
})
export class LoginWrapperComponent extends BaseComponent implements OnInit {
    public constructor(componentServiceCollector: ComponentServiceCollectorService, translate: TranslateService, private lifecycleService: LifecycleService,) {
        super(componentServiceCollector, translate);
    }

    /**
     * sets the title of the page
     */
    public ngOnInit(): void {
        super.setTitle(`Login`);
    }

    public resetCache(): void {
        this.lifecycleService.reset();
    }
}
