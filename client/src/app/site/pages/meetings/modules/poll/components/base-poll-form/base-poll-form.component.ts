import { Directive, inject, Input, OnInit } from '@angular/core';
import {
    AbstractControl,
    UntypedFormBuilder,
    UntypedFormControl,
    UntypedFormGroup,
    ValidatorFn,
    Validators
} from '@angular/forms';
import { combineLatest, distinctUntilChanged, map, Observable, startWith } from 'rxjs';
import {
    FormPollMethod,
    PollBackendDurationChoices,
    PollClassType,
    PollMethod,
    PollPercentBase,
    PollPercentBaseVerbose,
    PollPropertyVerbose,
    PollPropertyVerboseKey,
    PollType,
    PollTypeVerbose
} from 'src/app/domain/models/poll';
import { isNumberRange } from 'src/app/infrastructure/utils/validators';
import { BaseComponent } from 'src/app/site/base/base.component';
import { ParentErrorStateMatcher } from 'src/app/ui/modules/search-selector/validators';

import { GroupControllerService, ViewGroup } from '../../../../pages/participants';
import { ViewPoll } from '../../../../pages/polls';
import { MeetingSettingsService } from '../../../../services/meeting-settings.service';
import { VotingPrivacyWarningDialogService } from '../../modules/voting-privacy-dialog/services/voting-privacy-warning-dialog.service';
import { PollService } from '../../services/poll.service';

/**
 * Interface for determining, which choices are presented to the user in the poll-form.
 * If a certain choice needs to be hidden, the corresponding attribute in this interface needs to be set to true.
 */
export interface PollFormHideSelectsData {
    type?: boolean;
    entitledGroups?: boolean;
    pollMethod?: boolean;
    globalOptions?: boolean;
    hundredPercentBase?: boolean;
    backendDuration?: boolean;
}

@Directive()
export abstract class BasePollFormComponent extends BaseComponent implements OnInit {
    /**
     * The form-group for the meta-info.
     */
    public contentForm: UntypedFormGroup;
    public parentErrorStateMatcher = new ParentErrorStateMatcher();

    public PollType = PollType;
    public PollPropertyVerbose: Record<PollPropertyVerboseKey, string> = PollPropertyVerbose;
    public readonly pollBackendDurationChoices = PollBackendDurationChoices;

    /**
     * The different methods for this poll.
     */
    @Input()
    public pollMethods: Record<string, string>;

    /**
     * The different percent bases for this poll.
     */
    @Input()
    public percentBases: Record<string, string>;

    public alternativePercentBases = PollPercentBaseVerbose;

    @Input()
    public set data(data: Partial<ViewPoll>) {
        this._data = data;
        this.isCreatedList = data.isListPoll;
    }

    public get data(): Partial<ViewPoll> {
        return this._data;
    }

    /**
     * The flag to allow min/max votes on YNA and YN poll method
     */
    @Input()
    public allowToSetMinMax = false;

    public isCreatedList: boolean;

    public get isList(): boolean {
        return this.pollMethod === FormPollMethod.LIST_YNA || this.isCreatedList;
    }

    public get filteredPollMethods(): Record<string, string> {
        if (!this.isCreatedList || !this.pollMethods) {
            return this.pollMethods;
        }
        return Object.keys(this.pollMethods).reduce(
            (obj, key) => (key === key.toUpperCase() ? { ...obj, [key]: this.pollMethods[key] } : obj),
            {}
        );
    }

    public sortFn = (groupA: ViewGroup, groupB: ViewGroup): number => groupA.weight - groupB.weight;

    private _data: Partial<ViewPoll>;

    @Input()
    public pollOptionAmount: number;

    @Input()
    public pollService!: PollService;

    @Input()
    public pollClassType: PollClassType;

    /**
     * The different types the poll can accept.
     */
    @Input()
    public pollTypes = PollTypeVerbose;

    /**
     * the filtered `percentBases`.
     */
    public validPercentBases: Record<string, string>;

    /**
     * An twodimensional array to handle constant values for this poll.
     */
    public pollValues: [string, unknown][] = [];

    public showNonNominalWarning = false;

    public get isEVotingEnabled(): boolean {
        if (this.pollService) {
            return this.pollService.isElectronicVotingEnabled;
        } else {
            return false;
        }
    }

    public get isCreated(): boolean {
        return !this.data.state || this.data.isCreated; // no state means, its under creation
    }

    public get isEVotingSelected(): boolean {
        return this.pollTypeControl?.value !== PollType.Analog || false;
    }

    private get pollTypeControl(): AbstractControl {
        return this.contentForm.get(`type`);
    }

    private get pollMethodControl(): AbstractControl {
        return this.contentForm.get(`pollmethod`);
    }

    private get isPollMethodYNA(): boolean {
        return (this.contentForm?.get(`pollmethod`)?.value as PollMethod) === PollMethod.YNA;
    }

    private get isPollMethodYN(): boolean {
        return (this.contentForm?.get(`pollmethod`)?.value as PollMethod) === PollMethod.YN;
    }

    public get pollMethod(): FormPollMethod {
        return this.pollMethodControl.value as FormPollMethod;
    }

    private get globalYesControl(): AbstractControl {
        return this.contentForm.get(`global_yes`);
    }

    private get globalNoControl(): AbstractControl {
        return this.contentForm.get(`global_no`);
    }

    private get globalAbstainControl(): AbstractControl {
        return this.contentForm.get(`global_abstain`);
    }

    private get percentBaseControl(): AbstractControl {
        return this.contentForm.get(`onehundred_percent_base`);
    }

    public abstract get hideSelects(): PollFormHideSelectsData;

    public get pollMethodChangedToListObservable(): Observable<boolean> {
        return this.pollMethodControl.valueChanges.pipe(map(method => method === FormPollMethod.LIST_YNA));
    }

    private fb = inject(UntypedFormBuilder);
    public groupRepo = inject(GroupControllerService);
    private dialog = inject(VotingPrivacyWarningDialogService);
    protected meetingSettingsService = inject(MeetingSettingsService);
    /**
     * Constructor. Retrieves necessary metadata from the pollService,
     * injects the poll itself
     */
    public constructor() {
        super();
        this.initContentForm();
    }

    /**
     * OnInit.
     * Sets the observable for groups.
     */
    public ngOnInit(): void {
        if (this.data) {
            this.checkPollState();
            this.checkPollBackend();

            if (this.data.max_votes_per_option > 1 && !this.pollService.isMaxVotesPerOptionEnabled()) {
                // Reset max_votes_per_option if a poll has been created with max_votes_per_option>1 but
                // afterwards this features was disabled. The value will be reset as soon as the options
                // of this poll are edited.
                this.data.max_votes_per_option = 1;
            }

            this.patchFormValues(this.contentForm);
            this.updateFormControls(this.data);
            if (this.allowToSetMinMax && !this.data.id) {
                this.updatePollMethod(PollMethod.Y);
            } else if (this.allowToSetMinMax) {
                const controls = this.getVotesAmountControl();
                this.contentForm.get(`votes_amount`).get(`min_votes_amount`).setValidators(controls.get(`min_votes_amount`).validator);
                this.contentForm.get(`votes_amount`).get(`max_votes_amount`).setValidators(controls.get(`max_votes_amount`).validator);
                this.contentForm.get(`votes_amount`).get(`max_votes_per_option`).setValidators(controls.get(`max_votes_per_option`).validator);
            }
        }

        this.subscriptions.push(
            combineLatest([
                this.contentForm.valueChanges.pipe(startWith(``)),
                this.pollMethodControl.valueChanges.pipe(startWith(``)),
                this.pollTypeControl.valueChanges.pipe(startWith(``))
            ]).subscribe(([contentFormCh]) => {
                this.updateFormControls(contentFormCh);
            }),
            this.pollMethodControl.valueChanges
                .pipe(distinctUntilChanged())
                .subscribe(method => this.updatePollMethod(method))
        );

        // TODO: Fetch groups for repo search selection
    }

    /**
     * Updates the whole <poll-form />-component.
     *
     * @param update New data to pass into form-fields.
     */
    private updateFormControls(update: Partial<ViewPoll>): void {
        this.updatePollValues(update);
        this.updateGlobalVoteControls(update);
        this.updatePercentBases();
        this.setWarning();
    }

    private updatePollMethod(method: PollMethod): void {
        this.contentForm.removeControl(`votes_amount`);
        if (
            method === PollMethod.Y ||
            method === PollMethod.N ||
            ((method === PollMethod.YNA || method === PollMethod.YN) && this.allowToSetMinMax)
        ) {
            this.contentForm.addControl(`votes_amount`, this.getVotesAmountControl());
        }
        if (method === PollMethod.N) {
            this.contentForm.get(`votes_amount`).get(`max_votes_per_option`).setValue(1);
        }
    }

    /**
     * Generic recursive helper function to patch the form
     * will transitive move poll.min_votes_amount and poll.max_votes_amount into
     * form.votes_amount.min_votes_amount/max_votes_amount
     * @param formGroup
     */
    private patchFormValues(formGroup: UntypedFormGroup): void {
        for (const key of Object.keys(formGroup.controls)) {
            const currentControl = formGroup.controls[key];
            if (currentControl instanceof UntypedFormControl) {
                if (this.data[key]) {
                    currentControl.patchValue(this.data[key]);
                }
            } else if (currentControl instanceof UntypedFormGroup) {
                this.patchFormValues(currentControl);
            }
        }
    }

    private checkPollBackend(): void {
        const pollType = this.data.content_object?.collection as PollClassType;
        if (!this.data.backend) {
            if (pollType !== PollClassType.Topic) {
                this.data.backend = this.meetingSettingsService.instant(`${pollType}_poll_default_backend`);
            } else {
                this.data.backend = this.meetingSettingsService.instant(`poll_default_backend`);
            }
        }
    }

    private checkPollState(): void {
        if (this.data.state) {
            this.disablePollType();
        }
    }

    private disablePollType(): void {
        this.pollTypeControl.disable();
    }

    public showMinMaxVotes(data: any): boolean {
        const selectedPollMethod: FormPollMethod = this.pollMethodControl.value;
        return (
            (selectedPollMethod === FormPollMethod.Y ||
                (selectedPollMethod !== FormPollMethod.LIST_YNA && this.allowToSetMinMax)) &&
                (!data || !data.state || data.isCreated)
        );
    }

    public showMaxVotesPerOption(data: any): boolean {
        const selectedPollMethod: FormPollMethod = this.pollMethodControl.value;
        return selectedPollMethod === FormPollMethod.Y && (!data || !data.state || data.isCreated);
    }

    /**
     * updates the available percent bases according to the pollmethod
     * @param method the currently chosen pollmethod
     */
    private updatePercentBases(): void {
        const method = this.pollMethodControl.value.toUpperCase();
        const type = this.pollTypeControl.value;
        if (!method && !type) {
            return;
        }

        let forbiddenBases = [];
        if (method === PollMethod.YN) {
            forbiddenBases = [PollPercentBase.YNA, PollPercentBase.Y];
        } else if (method === PollMethod.YNA) {
            forbiddenBases = [PollPercentBase.Y];
        } else if (method === PollMethod.Y || PollMethod.N) {
            forbiddenBases = [PollPercentBase.YN, PollPercentBase.YNA];
        }

        if (type === PollType.Analog) {
            forbiddenBases.push(PollPercentBase.Entitled, PollPercentBase.EntitledPresent);
        }

        const bases = {};
        for (const [key, value] of Object.entries(this.percentBases)) {
            if (!forbiddenBases.includes(key)) {
                bases[key] = value;
            }
        }

        // update value in case that its no longer valid
        this.percentBaseControl.setValue(this.getNormedPercentBase(this.percentBaseControl.value, method, type), {
            emitEvent: false
        });

        this.validPercentBases = bases;
    }

    private getNormedPercentBase(base: PollPercentBase, method: PollMethod, type: PollType): PollPercentBase {
        if (method === PollMethod.YN && (base === PollPercentBase.YNA || base === PollPercentBase.Y)) {
            return PollPercentBase.YN;
        } else if (method === PollMethod.YNA && base === PollPercentBase.Y) {
            return PollPercentBase.YNA;
        } else if (method === PollMethod.Y && (base === PollPercentBase.YN || base === PollPercentBase.YNA)) {
            return PollPercentBase.Y;
        } else if (
            type === PollType.Analog &&
            (base === PollPercentBase.Entitled || base === PollPercentBase.EntitledPresent)
        ) {
            return PollPercentBase.Cast;
        }
        return base;
    }

    /**
     * Disable votes_amount form control if the poll type is anonymous
     * and the poll method is votes.
     */
    private setWarning(): void {
        if (this.pollTypeControl.value === PollType.Pseudoanonymous) {
            this.showNonNominalWarning = true;
        } else {
            this.showNonNominalWarning = false;
        }
    }

    public getValues(): Partial<{ [place in keyof ViewPoll]: any }> {
        return { ...this.data, ...this.serializeForm(this.contentForm) };
    }

    private serializeForm(formGroup: UntypedFormGroup): Partial<ViewPoll> {
        /**
         * getRawValue() includes disabled controls.
         * Required since the server assumes missing fields would imply "true"
         */
        const formData = { ...formGroup.getRawValue(), ...formGroup.value.votes_amount };
        delete formData.votes_amount;
        return formData;
    }

    /**
     * This updates the poll-values to get correct data in the view.
     *
     * @param data Passing the properties of the poll.
     */
    protected updatePollValues(data: Record<string, any>, additionalPollValues?: PollPropertyVerboseKey[]): void {
        if (this.data) {
            const pollMethod: FormPollMethod = data[`pollmethod`];
            const pollType: PollType = data[`type`];
            this.pollValues = [
                [
                    this.pollService.getVerboseNameForKey(`type`),
                    this.pollService.getVerboseNameForValue(`type`, data[`type`])
                ]
            ];
            // optional pollValues
            if (additionalPollValues) {
                additionalPollValues.forEach(value => {
                    this.pollValues.push([
                        this.pollService.getVerboseNameForKey(value),
                        this.pollService.getVerboseNameForValue(value, data[value])
                    ]);
                });
            }
            if (pollType !== PollType.Analog) {
                this.pollValues.push([
                    this.pollService.getVerboseNameForKey(`groups`),
                    data && data[`entitled_group_ids`] && data[`entitled_group_ids`].length
                        ? this.groupRepo.getNameForIds(...data[`entitled_group_ids`])
                        : `---`
                ]);
            }

            if (pollMethod === FormPollMethod.Y || pollMethod === FormPollMethod.N) {
                this.pollValues.push([this.pollService.getVerboseNameForKey(`global_yes`), data[`global_yes`]]);
                this.pollValues.push([this.pollService.getVerboseNameForKey(`global_no`), data[`global_no`]]);
                this.pollValues.push([this.pollService.getVerboseNameForKey(`global_abstain`), data[`global_abstain`]]);
                this.pollValues.push([this.pollService.getVerboseNameForKey(`votes_amount`), data[`votes_amount`]]);
                this.pollValues.push([
                    this.pollService.getVerboseNameForKey(`max_votes_amount`),
                    data[`max_votes_amount`]
                ]);
                this.pollValues.push([
                    this.pollService.getVerboseNameForKey(`min_votes_amount`),
                    data[`min_votes_amount`]
                ]);
            }

            if ((pollMethod === FormPollMethod.YNA || pollMethod === FormPollMethod.YN) && this.allowToSetMinMax) {
                this.pollValues.push([
                    this.pollService.getVerboseNameForKey(`max_votes_amount`),
                    data[`max_votes_amount`]
                ]);
                this.pollValues.push([
                    this.pollService.getVerboseNameForKey(`min_votes_amount`),
                    data[`min_votes_amount`]
                ]);
            }

            if (pollMethod === FormPollMethod.Y || pollMethod === FormPollMethod.N) {
                this.pollValues.push([
                    this.pollService.getVerboseNameForKey(`max_votes_per_option`),
                    data[`max_votes_per_option`]
                ]);
            }
        }
    }

    private enoughPollOptionsAvailable(minCtrlName: string, perOptionCtrlNam: string): ValidatorFn {
        return (formControl: AbstractControl): Record<string, any> | null => {
            if (this.meetingSettingsService.instant(`assignment_poll_enable_max_votes_per_option`) || !this.pollOptionAmount || this.isList) {
                return null;
            }
            const min = formControl.get(minCtrlName)!.value;
            const votesPerOption = formControl.get(perOptionCtrlNam)!.value || 1;
            if (this.pollOptionAmount * votesPerOption < min) {
                return { notEnoughOptionsError: true };
            }

            return null;
        };
    }

    private initContentForm(): void {
        this.contentForm = this.fb.group({
            title: [``, Validators.required],
            type: [``, Validators.required],
            pollmethod: [``, Validators.required],
            onehundred_percent_base: [``, Validators.required],
            votes_amount: this.getVotesAmountControl(),
            entitled_group_ids: [],
            backend: [],
            global_yes: [false],
            global_no: [false],
            global_abstain: [false]
        });
    }

    private getVotesAmountControl(): UntypedFormGroup {
        const maxVotesPreselect =
            (this.isPollMethodYNA || this.isPollMethodYN) && this.allowToSetMinMax ? this.pollOptionAmount : 1;
        const config = {
            max_votes_amount: [maxVotesPreselect, [Validators.required, Validators.min(1)]],
            min_votes_amount: [1, [Validators.required, Validators.min(1)]],
            max_votes_per_option: [1, [Validators.required, Validators.min(1)]]
        };
        if (this.allowToSetMinMax) {
            if (this.meetingSettingsService.instant(`assignment_poll_enable_max_votes_per_option`)) {
                config.max_votes_amount = [
                    maxVotesPreselect,
                    [Validators.required, Validators.min(1)]
                ];
            } else {
                config.max_votes_amount = [
                    maxVotesPreselect,
                    [Validators.required, Validators.min(1), Validators.max(this.pollOptionAmount)]
                ];
            }
        }
        return this.fb.group(config, {
            validators: [
                isNumberRange(`min_votes_amount`, `max_votes_amount`),
                this.enoughPollOptionsAvailable(`min_votes_amount`, `max_votes_per_option`),
                isNumberRange(`max_votes_per_option`, `max_votes_amount`, `rangeErrorMaxPerOption`)
            ]
        });
    }

    private enableGlobalVoteControls(): void {
        const suppressEvent = {
            emitEvent: false
        };
        this.globalYesControl.enable(suppressEvent);
        this.globalNoControl.enable(suppressEvent);
        this.globalAbstainControl.enable(suppressEvent);
    }

    /**
     * Function for disabling and emptying the global option form constrols.
     *
     * The controls that should be disabled can be specified via the parameters.
     * If no target controls are specified all three global options will be disabled.
     */
    private disableGlobalVoteControls(...toDisable: (`Yes` | `No` | `Abstain`)[]): void {
        const suppressEvent = {
            emitEvent: false
        };
        toDisable = toDisable.length ? toDisable : [`Yes`, `No`, `Abstain`];
        toDisable.forEach(name => {
            const control = this[`global${name}Control`];
            control.disable(suppressEvent);
            control.setValue(false, suppressEvent);
        });
    }

    private updateGlobalVoteControls(data: Partial<ViewPoll>): void {
        const pollMethod = data.pollmethod;
        if (pollMethod) {
            if (this.isList) {
                this.disableGlobalVoteControls();
                return;
            }
            this.enableGlobalVoteControls();
            if (pollMethod.includes(FormPollMethod.Y)) {
                this.disableGlobalVoteControls(`Yes`);
            }
            if (pollMethod.includes(FormPollMethod.N)) {
                this.disableGlobalVoteControls(`No`);
            }
            if (pollMethod.includes(FormPollMethod.YNA)) {
                this.disableGlobalVoteControls(`Abstain`);
            }
        }
    }

    public openVotingWarning(event: MouseEvent): void {
        event.stopPropagation();
        this.dialog.open();
    }

    /**
     * compare function used with the KeyValuePipe to display the percent bases in original order
     */
    public keepEntryOrder(): number {
        return 0;
    }

    public getErrorMessage(message: string): string {
        switch (message) {
            case `notEnoughOptionsError`:
                return this.translate.instant(`There are not enough options.`);
            case `rangeError`:
                return this.translate.instant(`Min votes cannot be greater than max votes.`);
            case `rangeErrorMaxPerOption`:
                return this.translate.instant(`Max votes per option cannot be greater than max votes.`);
            case `max`:
                return this.translate.instant(`Max votes cannot be greater than options.`);
            default:
                return ``;
        }
    }
}
