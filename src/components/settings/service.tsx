import * as React from "react"
import intl from "react-intl-universal"
import { ServiceConfigs, SyncService } from "../../schema-types"
import { Stack, Icon, Link, Dropdown, IDropdownOption } from "@fluentui/react"
import FreshRSSConfigsTab from "./services/freshrss"

type ServiceTabProps = {
    configs: ServiceConfigs
    save: (configs: ServiceConfigs) => void
    sync: () => Promise<void>
    remove: () => Promise<void>
    blockActions: () => void
    authenticate: (configs: ServiceConfigs) => Promise<boolean>
    reauthenticate: (configs: ServiceConfigs) => Promise<ServiceConfigs>
}

export type ServiceConfigsTabProps = ServiceTabProps & {
    exit: () => void
}

type ServiceTabState = {
    type: SyncService
}

export class ServiceTab extends React.Component<
    ServiceTabProps,
    ServiceTabState
> {
    constructor(props: ServiceTabProps) {
        super(props)
        this.state = {
            type: props.configs.type,
        }
    }

    serviceOptions = (): IDropdownOption[] => [
        { key: SyncService.FreshRSS, text: "FreshRSS (Google Reader API)" },
    ]

    onServiceOptionChange = (_, option: IDropdownOption) => {
        this.setState({ type: option.key as number })
    }

    exitConfigsTab = () => {
        this.setState({ type: SyncService.None })
    }

    getConfigsTab = () => {
        return <FreshRSSConfigsTab {...this.props} exit={this.exitConfigsTab} />
    }

    render = () => (
        <div className="tab-body">
            {this.state.type === SyncService.None ? (
                <Stack horizontalAlign="center" style={{ marginTop: 64 }}>
                    <Stack
                        className="settings-rules-icons"
                        horizontal
                        tokens={{ childrenGap: 12 }}>
                        <Icon iconName="ThisPC" />
                        <Icon iconName="Sync" />
                        <Icon iconName="Cloud" />
                    </Stack>
                    <span className="settings-hint">
                        {intl.get("service.intro")}
                        <Link
                            onClick={() =>
                                window.utils.openExternal(
                                    "https://freshrss.github.io/FreshRSS/en/users/06_Mobile_access.html#google-reader-api"
                                )
                            }
                            style={{ marginLeft: 6 }}>
                            {intl.get("rules.help")}
                        </Link>
                    </span>
                    <Dropdown
                        placeHolder={intl.get("service.select")}
                        options={this.serviceOptions()}
                        selectedKey={null}
                        onChange={this.onServiceOptionChange}
                        style={{ marginTop: 32, width: 180 }}
                    />
                </Stack>
            ) : (
                this.getConfigsTab()
            )}
        </div>
    )
}
