import classnames from 'classnames'
import * as React from 'react'

import { ClickSource, SectionList } from '../lib/list/section-list'
import {
  findNextSelectableRow,
  SelectionDirection,
} from '../lib/list/section-list-selection'
import { Row } from '../lib/row'
import { TextBox } from '../lib/text-box'

import xor from 'lodash/xor'
import { IMatch, IMatches, match } from '../../lib/fuzzy-find'
import { AriaLiveContainer } from '../accessibility/aria-live-container'
import * as octicons from '../octicons/octicons.generated'
import {
  IFilterListGroup,
  IFilterListItem,
  SelectionSource,
} from './filter-list'
import {
  InvalidRowIndexPath,
  RowIndexPath,
  rowIndexPathEquals,
} from './list/list-row-index-path'

interface IFlattenedGroup {
  readonly kind: 'group'
  readonly identifier: string
}

interface IFlattenedItem<T extends IFilterListItem> {
  readonly kind: 'item'
  readonly item: T
  /** Array of indexes in `item.text` that should be highlighted */
  readonly matches: IMatches
}

/**
 * A row in the list. This is used internally after the user-provided groups are
 * flattened.
 */
type IFilterListRow<T extends IFilterListItem> =
  | IFlattenedGroup
  | IFlattenedItem<T>

interface IAugmentedSectionFilterListProps<T extends IFilterListItem> {
  /** The unique identifier for the outer element of the component (optional, defaults to null) */
  readonly id?: string

  /** A class name for the wrapping element. */
  readonly className?: string

  /** The height of the rows. */
  readonly rowHeight: number

  /** The ordered groups to display in the list. */
  // eslint-disable-next-line react/no-unused-prop-types
  readonly groups: ReadonlyArray<IFilterListGroup<T>>

  /** The selected item. */
  readonly selectedItems: ReadonlyArray<T>

  /** Called to render each visible item. */
  readonly renderItem: (item: T, matches: IMatches) => JSX.Element | null

  /** Called to render header for the group with the given identifier. */
  readonly renderGroupHeader?: (identifier: string) => JSX.Element | null

  /** Called to render content before/above the filter and list. */
  readonly renderPreList?: () => JSX.Element | null

  /**
   * This function will be called when a pointer device is pressed and then
   * released on a selectable row. Note that this follows the conventions
   * of button elements such that pressing Enter or Space on a keyboard
   * while focused on a particular row will also trigger this event. Consumers
   * can differentiate between the two using the source parameter.
   *
   * Note that this event handler will not be called for keyboard events
   * if `event.preventDefault()` was called in the onRowKeyDown event handler.
   *
   * Consumers of this event do _not_ have to call event.preventDefault,
   * when this event is subscribed to the list will automatically call it.
   */
  readonly onItemClick?: (item: T, source: ClickSource) => void

  readonly onItemDoubleClick?: (item: T, source: ClickSource) => void

  /**
   * This function will be called when the selection changes as a result of a
   * user keyboard or mouse action (i.e. not when props change). This function
   * will not be invoked when an already selected row is clicked on.
   *
   * @param selectedItem - The item that was just selected
   * @param source       - The kind of user action that provoked the change,
   *                       either a pointer device press, or a keyboard event
   *                       (arrow up/down)
   */
  readonly onSelectionChanged?: (
    selectedItems: ReadonlyArray<T>,
    source: SelectionSource
  ) => void

  /**
   * Called when a key down happens in the filter text input. Users have a
   * chance to respond or cancel the default behavior by calling
   * `preventDefault()`.
   */
  readonly onFilterKeyDown?: (
    event: React.KeyboardEvent<HTMLInputElement>
  ) => void

  /** Called when the Enter key is pressed in field of type search */
  readonly onEnterPressedWithoutFilteredItems?: (text: string) => void

  /** Aria label for a specific item */
  readonly getItemAriaLabel?: (item: T) => string | undefined

  /** Aria label for a specific group */
  readonly getGroupAriaLabel?: (group: number) => string | undefined

  /** The current filter text to use in the form */
  readonly filterText?: string

  /** An optional filter that can be applied in addition of the filter text */
  // It is used in the createStateUpdate - so not directly in the component.
  // eslint-disable-next-line react/no-unused-prop-types
  readonly filterMethod?: (item: T) => boolean

  /** Called when the filter text is changed by the user */
  readonly onFilterTextChanged?: (text: string) => void

  /**
   * Whether or not the filter list should allow selection
   * and filtering. Defaults to false.
   */
  readonly disabled?: boolean

  /** Any props which should cause a re-render if they change. */
  readonly invalidationProps: any

  /**
   * Called to render content after the filter input (in same <Row> element).
   *  - has been used for an inline button after the filter.
   */
  readonly renderPostFilter?: () => JSX.Element | null

  /**
   * Called to to allow providing a custom filter row as opposed to the default one.
   */
  readonly renderCustomFilterRow?: () => JSX.Element | null

  /** Called when there are no items to render.  */
  readonly renderNoItems?: () => JSX.Element | null

  /**
   * A reference to a TextBox that will be used to control this component.
   *
   * See https://github.com/xixu-me/git-desktop/issues/4317 for refactoring work to
   * make this more composable which should make this unnecessary.
   */
  readonly filterTextBox?: TextBox

  /**
   * Callback to fire when the items in the filter list are updated
   */
  readonly onFilterListResultsChanged?: (
    filteredItems: ReadonlyArray<T>
  ) => void

  /** Placeholder text for text box. Default is "Filter". */
  readonly placeholderText?: string

  /** If true, we do not render the filter. */
  readonly hideFilterRow?: boolean

  /**
   * A handler called whenever a context menu event is received on the
   * row container element.
   *
   * The context menu is invoked when a user right clicks the row or
   * uses keyboard shortcut.s
   */
  readonly onItemContextMenu?: (
    item: T,
    event: React.MouseEvent<HTMLDivElement>
  ) => void

  /** This function will be called only when an item obtains focus via keyboard */
  readonly onItemKeyboardFocus?: (
    item: T,
    event: React.KeyboardEvent<any>
  ) => void

  /** This function will be called when a row loses focus */
  readonly onItemBlur?: (
    item: T,
    event: React.FocusEvent<HTMLDivElement>
  ) => void

  readonly onItemKeyDown?: (item: T, event: React.KeyboardEvent<any>) => void

  readonly onScroll?: (scrollTop: number, clientHeight: number) => void

  /**
   * The number of pixels from the top of the list indicating
   * where to scroll do on rendering of the list.
   */
  readonly setScrollTop?: number

  /** A message to be announced after the no results message - Used to pass in
   * any messaging shown to visual users */
  readonly postNoResultsMessage?: string

  /**
   * This prop defines the behaviour of the selection of items within this list.
   *  - 'single' : (default) single list-item selection. [shift] and [ctrl] have
   * no effect. Use in combination with one of:
   *             onSelectedRowChanged(row: T)
   *             onSelectionChanged(rows: T[])
   *  - 'multi' : allows range and/or arbitrary selection. [shift] and [ctrl]
   * can be used. Use in combination with:
   *    onSelectionChanged(rows: T[])
   *
   * Note... the SectionList also has 'range' and this has not been implemented
   * in this filter list (not needed yet)
   */
  readonly selectionMode?: 'single' | 'multi'
}

interface IAugmentedSectionFilterListState<T extends IFilterListItem> {
  readonly rows: ReadonlyArray<ReadonlyArray<IFilterListRow<T>>>
  readonly selectedRows: ReadonlyArray<RowIndexPath>
  readonly filterValue: string
  readonly filterValueChanged: boolean
  // Indices of groups in the filtered list
  readonly groups: ReadonlyArray<number>
}

/** A List which includes the ability to filter based on its contents. */
export class AugmentedSectionFilterList<
  T extends IFilterListItem
> extends React.Component<
  IAugmentedSectionFilterListProps<T>,
  IAugmentedSectionFilterListState<T>
> {
  private list: SectionList | null = null
  private filterTextBox: TextBox | null = null

  public constructor(props: IAugmentedSectionFilterListProps<T>) {
    super(props)

    if (props.filterTextBox !== undefined) {
      this.filterTextBox = props.filterTextBox
    }

    this.state = createStateUpdate(props, null)
  }

  public componentWillReceiveProps(
    nextProps: IAugmentedSectionFilterListProps<T>
  ) {
    this.setState(createStateUpdate(nextProps, this.state))
  }

  public componentDidUpdate(
    prevProps: IAugmentedSectionFilterListProps<T>,
    prevState: IAugmentedSectionFilterListState<T>
  ) {
    if (this.props.onSelectionChanged) {
      const oldSelectedItemIds = prevState.selectedRows
        .map(row => getItemIdFromRowIndex(prevState.rows, row))
        .filter(i => i !== null)
      const newSelectedItemIds = this.state.selectedRows
        .map(row => getItemIdFromRowIndex(this.state.rows, row))
        .filter(i => i !== null)

      if (!this.hasSameIds(oldSelectedItemIds, newSelectedItemIds)) {
        const propSelectionIds = this.props.selectedItems.map(si => si.id)

        if (!this.hasSameIds(newSelectedItemIds, propSelectionIds)) {
          const newSelectedItems = this.state.selectedRows
            .map(row => getItemFromRowIndex(this.state.rows, row))
            .filter(r => r !== null)

          this.props.onSelectionChanged(newSelectedItems, {
            kind: 'filter',
            filterText: this.props.filterText || '',
          })
        }
      }
    }

    if (this.props.onFilterListResultsChanged !== undefined) {
      const oldFilteredIds = prevState.rows
        .flat()
        .filter(row => row.kind === 'item')
        .map(r => r.item.id)

      const currentFilteredItemIds = this.state.rows
        .flat()
        .filter(row => row.kind === 'item')
        .map(r => r.item)

      const currentFilteredIds = currentFilteredItemIds.map(i => i.id)

      if (!this.hasSameIds(oldFilteredIds, currentFilteredIds)) {
        this.props.onFilterListResultsChanged(currentFilteredItemIds)
      }
    }
  }

  private hasSameIds(
    oldIds: ReadonlyArray<string>,
    newIds: ReadonlyArray<string>
  ) {
    if (oldIds.length !== newIds.length) {
      return false
    }

    // xor  = exclusive Or; returns the symmetric difference of given arrays
    // i.e. it will create an array that contains an id that doesn’t exist in
    // both arrays. If no empty array, then both arrays contain the same elements.
    return xor(oldIds, newIds).length === 0
  }

  public componentDidMount() {
    if (this.filterTextBox !== null) {
      this.filterTextBox.selectAll()
    }
  }

  public renderTextBox() {
    return (
      <TextBox
        ref={this.onTextBoxRef}
        displayClearButton={true}
        prefixedIcon={octicons.search}
        autoFocus={true}
        placeholder={this.props.placeholderText || 'Filter'}
        className="filter-list-filter-field"
        onValueChanged={this.onFilterValueChanged}
        onEnterPressed={this.onEnterPressed}
        onKeyDown={this.onKeyDown}
        value={this.props.filterText}
        disabled={this.props.disabled}
      />
    )
  }

  public renderLiveContainer() {
    if (!this.state.filterValueChanged) {
      return null
    }

    const itemRows = this.state.rows.flat().filter(row => row.kind === 'item')
    const resultsPluralized = itemRows.length === 1 ? 'result' : 'results'
    const postNoResultsMessage =
      itemRows.length === 0 ? this.props.postNoResultsMessage : ''
    const screenReaderMessage = `${itemRows.length} ${resultsPluralized} ${postNoResultsMessage}`

    const tracked = `${this.state.filterValue} ${
      this.props.filterMethod ? 'fm' : ''
    }`
    return (
      <AriaLiveContainer
        trackedUserInput={tracked}
        message={screenReaderMessage}
      />
    )
  }

  public renderFilterRow() {
    if (this.props.hideFilterRow === true) {
      return null
    }

    if (this.props.renderCustomFilterRow) {
      return this.props.renderCustomFilterRow()
    }

    return (
      <Row className="filter-field-row">
        {this.props.filterTextBox === undefined ? this.renderTextBox() : null}
        {this.props.renderPostFilter ? this.props.renderPostFilter() : null}
      </Row>
    )
  }

  public render() {
    return (
      <div className={classnames('filter-list', this.props.className)}>
        {this.renderLiveContainer()}

        {this.props.renderPreList ? this.props.renderPreList() : null}

        {this.renderFilterRow()}

        <div className="filter-list-container">{this.renderContent()}</div>
      </div>
    )
  }

  public selectNextItem(
    focus: boolean = false,
    inDirection: SelectionDirection = 'down'
  ) {
    if (this.list === null) {
      return
    }

    const lastSelectedRow = this.state.selectedRows.at(-1)

    if (lastSelectedRow === undefined) {
      return
    }

    let next: RowIndexPath | null = null

    const rowCount = this.state.rows.map(r => r.length)
    if (
      lastSelectedRow.row === -1 ||
      lastSelectedRow.row === this.state.rows.length
    ) {
      next = findNextSelectableRow(
        rowCount,
        {
          direction: inDirection,
          row: InvalidRowIndexPath,
        },
        this.canSelectRow
      )
    } else {
      next = findNextSelectableRow(
        rowCount,
        {
          direction: inDirection,
          row: lastSelectedRow,
        },
        this.canSelectRow
      )
    }

    if (next !== null) {
      this.setState({ selectedRows: [next] }, () => {
        if (focus && this.list !== null) {
          this.list.focus()
        }
      })
    }
  }

  private renderContent() {
    if (this.state.rows.length === 0 && this.props.renderNoItems) {
      return this.props.renderNoItems()
    } else {
      const firstSelectedRow = this.state.selectedRows.at(-1)

      return (
        <SectionList
          id={this.props.id}
          ref={this.onListRef}
          rowCount={this.state.rows.map(r => r.length)}
          rowRenderer={this.renderRow}
          sectionHasHeader={this.sectionHasHeader}
          getRowAriaLabel={this.getRowAriaLabel}
          rowHeight={this.props.rowHeight}
          selectedRows={
            firstSelectedRow &&
            rowIndexPathEquals(firstSelectedRow, InvalidRowIndexPath)
              ? []
              : this.state.selectedRows
          }
          onSelectionChanged={this.onRowSelectionChanged}
          onRowClick={this.onRowClick}
          onRowDoubleClick={this.onRowDoubleClick}
          onRowKeyDown={this.onRowKeyDown}
          onRowContextMenu={this.onRowContextMenu}
          onRowKeyboardFocus={this.onRowKeyboardFocus}
          onRowBlur={this.onRowBlur}
          canSelectRow={this.canSelectRow}
          invalidationProps={{
            ...this.props,
            ...this.props.invalidationProps,
          }}
          onScroll={this.props.onScroll}
          setScrollTop={this.props.setScrollTop}
          selectionMode={this.props.selectionMode}
          getSectionAriaLabel={this.getSectionAriaLabel}
        />
      )
    }
  }

  private sectionHasHeader = (section: number) => {
    const rows = this.state.rows[section]
    return rows.length > 0 && rows[0].kind === 'group'
  }

  private getRowAriaLabel = (index: RowIndexPath) => {
    const row = this.state.rows[index.section][index.row]
    if (row.kind !== 'item') {
      return undefined
    }

    const itemAriaLabel = this.props.getItemAriaLabel?.(row.item)

    if (itemAriaLabel === undefined) {
      return undefined
    }

    const groupAriaLabel = this.props.getGroupAriaLabel?.(
      this.state.groups[index.section]
    )

    return groupAriaLabel !== undefined
      ? `${itemAriaLabel}, ${groupAriaLabel}`
      : itemAriaLabel
  }

  private getSectionAriaLabel = (section: number) => {
    const groupAriaLabel = this.props.getGroupAriaLabel?.(
      this.state.groups[section]
    )

    return groupAriaLabel !== undefined ? groupAriaLabel : undefined
  }

  private renderRow = (index: RowIndexPath) => {
    const row = this.state.rows[index.section][index.row]
    if (row.kind === 'item') {
      return this.props.renderItem(row.item, row.matches)
    } else if (this.props.renderGroupHeader) {
      return this.props.renderGroupHeader(row.identifier)
    } else {
      return null
    }
  }

  private onTextBoxRef = (component: TextBox | null) => {
    this.filterTextBox = component
  }

  private onListRef = (instance: SectionList | null) => {
    this.list = instance
  }

  private onFilterValueChanged = (text: string) => {
    if (this.props.onFilterTextChanged) {
      this.props.onFilterTextChanged(text)
    }
  }

  private onEnterPressed = (text: string) => {
    const rows = this.state.rows.length
    if (
      rows === 0 &&
      text.trim().length > 0 &&
      this.props.onEnterPressedWithoutFilteredItems !== undefined
    ) {
      this.props.onEnterPressedWithoutFilteredItems(text)
    }
  }

  private onRowSelectionChanged = (
    rows: ReadonlyArray<RowIndexPath>,
    source: SelectionSource
  ) => {
    this.setState({ selectedRows: rows })

    if (this.props.onSelectionChanged) {
      const items = rows
        .map(index => this.state.rows[index.section][index.row])
        .filter(r => r.kind === 'item')
        .map(r => r.item)
      this.props.onSelectionChanged(items, source)
    }
  }

  private canSelectRow = (index: RowIndexPath) => {
    if (this.props.disabled) {
      return false
    }

    const row = this.state.rows[index.section][index.row]
    return row.kind === 'item'
  }

  private onRowClick = (index: RowIndexPath, source: ClickSource) => {
    if (this.props.onItemClick) {
      const row = this.state.rows[index.section][index.row]

      if (row.kind === 'item') {
        this.props.onItemClick(row.item, source)
      }
    }
  }

  private onRowDoubleClick = (index: RowIndexPath, source: ClickSource) => {
    if (this.props.onItemDoubleClick) {
      const row = this.state.rows[index.section][index.row]

      if (row.kind === 'item') {
        this.props.onItemDoubleClick(row.item, source)
      }
    }
  }

  private onRowContextMenu = (
    index: RowIndexPath,
    source: React.MouseEvent<HTMLDivElement>
  ) => {
    if (!this.props.onItemContextMenu) {
      return
    }

    const row = this.state.rows[index.section][index.row]

    if (row.kind !== 'item') {
      return
    }

    this.props.onItemContextMenu(row.item, source)
  }

  private onRowKeyboardFocus = (
    index: RowIndexPath,
    source: React.KeyboardEvent<any>
  ) => {
    if (!this.props.onItemKeyboardFocus) {
      return
    }

    const row = this.state.rows[index.section][index.row]

    if (row.kind !== 'item') {
      return
    }

    this.props.onItemKeyboardFocus(row.item, source)
  }

  private onRowBlur = (
    index: RowIndexPath,
    source: React.FocusEvent<HTMLDivElement>
  ) => {
    if (!this.props.onItemBlur) {
      return
    }

    const row = this.state.rows[index.section][index.row]

    if (row.kind !== 'item') {
      return
    }

    this.props.onItemBlur(row.item, source)
  }

  private onRowKeyDown = (
    indexPath: RowIndexPath,
    event: React.KeyboardEvent<any>
  ) => {
    const row = this.state.rows[indexPath.section][indexPath.row]

    if (row.kind === 'item' && this.props.onItemKeyDown) {
      this.props.onItemKeyDown(row.item, event)
    }

    if (event.defaultPrevented) {
      return
    }

    const list = this.list
    if (!list) {
      return
    }

    const rowCount = this.state.rows.map(r => r.length)

    const firstSelectableRow = findNextSelectableRow(
      rowCount,
      { direction: 'down', row: InvalidRowIndexPath },
      this.canSelectRow
    )
    const lastSelectableRow = findNextSelectableRow(
      rowCount,
      {
        direction: 'up',
        row: {
          section: 0,
          row: 0,
        },
      },
      this.canSelectRow
    )

    let shouldFocus = false

    if (
      event.key === 'ArrowUp' &&
      firstSelectableRow &&
      rowIndexPathEquals(indexPath, firstSelectableRow)
    ) {
      shouldFocus = true
    } else if (
      event.key === 'ArrowDown' &&
      lastSelectableRow &&
      rowIndexPathEquals(indexPath, lastSelectableRow)
    ) {
      shouldFocus = true
    }

    if (shouldFocus) {
      const textBox = this.filterTextBox

      if (textBox) {
        event.preventDefault()
        textBox.focus()
      }
    }
  }

  public onKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    const list = this.list
    const key = event.key

    if (!list) {
      return
    }

    if (this.props.onFilterKeyDown) {
      this.props.onFilterKeyDown(event)
    }

    if (event.defaultPrevented) {
      return
    }

    const rowCount = this.state.rows.map(r => r.length)

    if (key === 'ArrowDown') {
      if (rowCount.length > 0) {
        const selectedRow = findNextSelectableRow(
          rowCount,
          { direction: 'down', row: InvalidRowIndexPath },
          this.canSelectRow
        )
        if (selectedRow != null) {
          this.setState({ selectedRows: [selectedRow] }, () => {
            list.focus()
          })
        }
      }

      event.preventDefault()
    } else if (key === 'ArrowUp') {
      if (rowCount.length > 0) {
        const selectedRow = findNextSelectableRow(
          rowCount,
          {
            direction: 'up',
            row: {
              section: 0,
              row: 0,
            },
          },
          this.canSelectRow
        )
        if (selectedRow != null) {
          this.setState({ selectedRows: [selectedRow] }, () => {
            list.focus()
          })
        }
      }

      event.preventDefault()
    } else if (key === 'Enter') {
      // no repositories currently displayed, bail out
      if (rowCount.length === 0) {
        return event.preventDefault()
      }

      const filterText = this.props.filterText

      if (filterText !== undefined && !/\S/.test(filterText)) {
        return event.preventDefault()
      }

      const row = findNextSelectableRow(
        rowCount,
        { direction: 'down', row: InvalidRowIndexPath },
        this.canSelectRow
      )

      if (row != null) {
        this.onRowClick(row, { kind: 'keyboard', event })
      }
    }
  }
}

export function getText<T extends IFilterListItem>(
  item: T
): ReadonlyArray<string> {
  return item['text']
}

function getFirstVisibleRow<T extends IFilterListItem>(
  rows: ReadonlyArray<ReadonlyArray<IFilterListRow<T>>>
): RowIndexPath {
  for (let i = 0; i < rows.length; i++) {
    const groupRows = rows[i]
    for (let j = 0; j < groupRows.length; j++) {
      const row = groupRows[j]
      if (row.kind === 'item') {
        return { section: i, row: j }
      }
    }
  }

  return InvalidRowIndexPath
}

function createStateUpdate<T extends IFilterListItem>(
  props: IAugmentedSectionFilterListProps<T>,
  state: IAugmentedSectionFilterListState<T> | null
) {
  const rows = new Array<Array<IFilterListRow<T>>>()
  const filter = (props.filterText || '').toLowerCase()
  const { filterMethod, selectedItems } = props
  const selectedRows = []
  let section = 0
  const groupIndices = []
  let filterValueChanged = state?.filterValueChanged ? true : filter.length > 0

  for (const [idx, group] of props.groups.entries()) {
    const groupRows = new Array<IFilterListRow<T>>()

    const itemsToMatch = filterMethod
      ? group.items.filter(filterMethod)
      : group.items

    const items: ReadonlyArray<IMatch<T>> = filter
      ? match(filter, itemsToMatch, getText)
      : itemsToMatch.map(item => ({
          score: 1,
          matches: { title: [], subtitle: [] },
          item,
        }))

    if (group.items.length !== items.length) {
      filterValueChanged = true
    }

    if (!items.length) {
      continue
    }

    groupIndices.push(idx)

    if (props.renderGroupHeader) {
      groupRows.push({ kind: 'group', identifier: group.identifier })
    }

    for (const { item, matches } of items) {
      if (selectedItems.some(si => item.id === si.id)) {
        selectedRows.push({
          section,
          row: groupRows.length,
        })
      }

      groupRows.push({ kind: 'item', item, matches })
    }

    rows.push(groupRows)
    section++
  }

  if (selectedRows.length === 0 && filter.length) {
    // If the selected item isn't in the list (e.g., filtered out), then
    // select the first visible item.
    selectedRows.push(getFirstVisibleRow(rows))
  }

  return {
    rows: rows,
    selectedRows,
    filterValue: filter,
    filterValueChanged,
    groups: groupIndices,
  }
}

function getItemFromRowIndex<T extends IFilterListItem>(
  items: ReadonlyArray<ReadonlyArray<IFilterListRow<T>>>,
  index: RowIndexPath
): T | null {
  if (index.section < 0 || index.section >= items.length) {
    return null
  }

  const group = items[index.section]
  if (index.row < 0 || index.row >= group.length) {
    return null
  }

  const row = group[index.row]

  if (row.kind === 'item') {
    return row.item
  }

  return null
}

function getItemIdFromRowIndex<T extends IFilterListItem>(
  items: ReadonlyArray<ReadonlyArray<IFilterListRow<T>>>,
  index: RowIndexPath
): string | null {
  const item = getItemFromRowIndex(items, index)
  return item ? item.id : null
}
